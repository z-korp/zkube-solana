package com.zkorp.zkube.unitywallet

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class SecretVault(context: Context,
    private val commit: (SharedPreferences.Editor) -> Boolean = { it.commit() },
    private val keyProvider: () -> SecretKey = ::androidKey) {
    private val storage = context.getSharedPreferences("zkube-unity-secrets-v1", Context.MODE_PRIVATE)

    fun put(name: String, value: ByteArray) {
        check(commit(storage.edit().putString(name, encrypt(name, value))))
    }

    // Re-encryption binds the promoted ciphertext to its new AAD name. Both
    // mutations reach the durable store in the same commit.
    fun putAndRemove(name: String, value: ByteArray, removedName: String) {
        require(name != removedName)
        check(commit(storage.edit().putString(name, encrypt(name, value)).remove(removedName)))
    }

    private fun encrypt(name: String, value: ByteArray): String {
        require(value.size <= 16384)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keyProvider())
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val encoded = byteArrayOf(1) + cipher.iv + cipher.doFinal(value)
        return Base64.encodeToString(encoded, Base64.NO_WRAP)
    }

    fun get(name: String): ByteArray? {
        val stored = storage.getString(name, null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            require(bytes.size in 29..16413 && bytes[0].toInt() == 1)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, keyProvider(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
            cipher.doFinal(bytes, 13, bytes.size - 13)
        } catch (_: Exception) {
            // Key invalidation or corrupted ciphertext requires owner reauthorization.
            // Durable run locators are deliberately stored outside this secret vault.
            remove(name)
            null
        }
    }

    fun remove(name: String) { check(commit(storage.edit().remove(name))) }
}

@Synchronized private fun androidKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val alias = "zkube-unity-v1"
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build())
    }.generateKey()
}
