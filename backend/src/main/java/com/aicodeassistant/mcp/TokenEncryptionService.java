package com.aicodeassistant.mcp;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Set;

/**
 * OAuth 令牌 AES-256-GCM 加密服务。
 * <p>
 * 提供对称加密/解密能力，用于保护 MCP OAuth 令牌的本地存储安全。
 * 加密后数据格式: {@code ENC:<Base64(IV + ciphertext + GCM-tag)>}。
 * <p>
 * 密钥解析优先级:
 * <ol>
 *   <li>Spring 配置 {@code zhiku.encryption.key}（Base64 编码）</li>
 *   <li>环境变量 {@code ZHIKU_ENCRYPTION_KEY}（Base64 编码）</li>
 *   <li>文件 {@code ~/.zhiku/.master-key}（已存在则读取）</li>
 *   <li>自动生成新密钥并写入 {@code ~/.zhiku/.master-key}</li>
 * </ol>
 */
@Service
public class TokenEncryptionService {

    private static final Logger log = LoggerFactory.getLogger(TokenEncryptionService.class);

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;   // 96 bits
    private static final int GCM_TAG_LENGTH = 128;  // bits
    private static final String KEY_ENV_VAR = "ZHIKU_ENCRYPTION_KEY";
    private static final String ENCRYPTED_PREFIX = "ENC:";

    private static final Path KEY_DIR = Path.of(System.getProperty("user.home"), ".zhiku");
    private static final Path KEY_FILE = KEY_DIR.resolve(".master-key");

    private final SecretKey secretKey;
    private final SecureRandom secureRandom = new SecureRandom();
    /**
     * 密钥是否来自稳定来源（Spring 配置、环境变量或已存在的密钥文件）。
     * 为 false 表示本次进程临时生成了密钥：进程所在的文件系统若不持久（例如容器重建），
     * 用它加密的数据下次就解不开。需要长期保存密文的调用方应据此拒绝写入。
     */
    private final boolean keyFromPersistentSource;

    public TokenEncryptionService(@Value("${zhiku.encryption.key:}") String configKey) {
        KeyResolution resolution = resolveKey(configKey);
        this.secretKey = resolution.secretKey();
        this.keyFromPersistentSource = resolution.persistent();
        log.info("TokenEncryptionService initialized — encryption key loaded (persistent source: {})",
                keyFromPersistentSource);
    }

    /** 加密密钥在进程重启后是否仍然可用；false 时不应把密文当作可长期保存的数据。 */
    public boolean keyIsPersistent() {
        return keyFromPersistentSource;
    }

    /**
     * AES-256-GCM 加密。
     *
     * @param plaintext 明文字符串
     * @return 格式 {@code ENC:<Base64(IV + ciphertext + GCM-tag)>}
     */
    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            // IV + ciphertext (包含 GCM tag)
            byte[] combined = new byte[GCM_IV_LENGTH + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, GCM_IV_LENGTH);
            System.arraycopy(ciphertext, 0, combined, GCM_IV_LENGTH, ciphertext.length);

            return ENCRYPTED_PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new RuntimeException("Token encryption failed", e);
        }
    }

    /**
     * AES-256-GCM 解密。向后兼容明文令牌。
     * <p>
     * 如果输入不以 {@code ENC:} 开头，视为旧版明文直接返回。
     *
     * @param encrypted 加密字符串或明文
     * @return 解密后的明文
     */
    public String decrypt(String encrypted) {
        if (encrypted == null || encrypted.isEmpty()) {
            return encrypted;
        }
        // 向后兼容：不以 ENC: 开头的视为明文
        if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
            return encrypted;
        }

        try {
            byte[] combined = Base64.getDecoder().decode(
                    encrypted.substring(ENCRYPTED_PREFIX.length()));

            byte[] iv = new byte[GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);

            byte[] ciphertext = new byte[combined.length - GCM_IV_LENGTH];
            System.arraycopy(combined, GCM_IV_LENGTH, ciphertext, 0, ciphertext.length);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] plainBytes = cipher.doFinal(ciphertext);
            return new String(plainBytes, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("Token decryption failed", e);
        }
    }

    /**
     * 密钥解析 — 按优先级尝试:
     * 1) Spring 配置 (Base64)  2) 环境变量 (Base64)  3) 文件  4) 自动生成
     */
    private record KeyResolution(SecretKey secretKey, boolean persistent) {}

    private KeyResolution resolveKey(String configKey) {
        // 1. Spring 配置
        if (configKey != null && !configKey.isBlank()) {
            log.info("Using encryption key from Spring configuration");
            return new KeyResolution(decodeBase64Key(configKey), true);
        }

        // 2. 环境变量
        String envKey = System.getenv(KEY_ENV_VAR);
        if (envKey != null && !envKey.isBlank()) {
            log.info("Using encryption key from environment variable {}", KEY_ENV_VAR);
            return new KeyResolution(decodeBase64Key(envKey), true);
        }

        // 3. 文件 ~/.zhiku/.master-key
        if (Files.exists(KEY_FILE)) {
            try {
                String fileKey = Files.readString(KEY_FILE).trim();
                log.info("Using encryption key from file {}", KEY_FILE);
                return new KeyResolution(decodeBase64Key(fileKey), true);
            } catch (IOException e) {
                log.warn("Failed to read key file {}: {}", KEY_FILE, e.getMessage());
            }
        }

        // 4. 自动生成并持久化：只能假定该文件在本进程生命周期内可用
        log.info("No encryption key found — generating new key and persisting to {}", KEY_FILE);
        return new KeyResolution(generateAndPersistKey(KEY_FILE), false);
    }

    private SecretKey decodeBase64Key(String base64Key) {
        byte[] keyBytes = Base64.getDecoder().decode(base64Key);
        if (keyBytes.length != 32) {
            throw new IllegalArgumentException(
                    "Encryption key must be 256 bits (32 bytes), got " + keyBytes.length + " bytes");
        }
        return new SecretKeySpec(keyBytes, "AES");
    }

    /**
     * 生成 256-bit 随机密钥，持久化到指定文件，设置权限 600（仅 POSIX 系统）。
     */
    private SecretKey generateAndPersistKey(Path keyFile) {
        try {
            KeyGenerator keyGen = KeyGenerator.getInstance("AES");
            keyGen.init(256, secureRandom);
            SecretKey key = keyGen.generateKey();

            Files.createDirectories(keyFile.getParent());
            String encoded = Base64.getEncoder().encodeToString(key.getEncoded());
            Files.writeString(keyFile, encoded);

            // 设置文件权限 600（仅 POSIX 系统）
            try {
                Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
                Files.setPosixFilePermissions(keyFile, perms);
                log.info("Key file permissions set to 600: {}", keyFile);
            } catch (UnsupportedOperationException e) {
                log.warn("POSIX file permissions not supported on this system — " +
                        "please manually secure {}", keyFile);
            }

            log.info("New encryption key generated and saved to {}", keyFile);
            return key;
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate and persist encryption key", e);
        }
    }
}
