package com.zkorp.zkube.unitywallet

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.security.MessageDigest
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
class CandidatePromotionTest {
    private fun fingerprint(seed: ByteArray) = MessageDigest.getInstance("SHA-256").digest(seed)

    @Test fun promotionUsesOneDurableEncryptedCommitAndIsIdempotentAfterRestart() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        var commits = 0
        val vault = SecretVault(context, commit = { commits++; it.commit() }) { key }
        val old = ByteArray(32) { 1 }; val next = ByteArray(32) { 2 }
        vault.put("device:owner", old); vault.put("device-candidate:owner", next); commits = 0
        DeviceSeeds.promote(vault, "owner", fingerprint(old), fingerprint(next))
        assertEquals(1, commits)
        val restored = SecretVault(context) { key }
        assertArrayEquals(next, restored.get("device:owner")); assertNull(restored.get("device-candidate:owner"))
        DeviceSeeds.promote(vault, "owner", fingerprint(old), fingerprint(next))
        assertEquals(1, commits)
    }

    @Test fun interveningSeedChangeAndWrongOwnerCannotPromote() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = SecretVault(context) { key }
        val old = ByteArray(32) { 1 }; val next = ByteArray(32) { 2 }; val replacement = ByteArray(32) { 3 }
        vault.put("device:owner", old); vault.put("device-candidate:owner", replacement)
        assertThrows(IllegalStateException::class.java) { DeviceSeeds.promote(vault, "owner", fingerprint(old), fingerprint(next)) }
        assertThrows(IllegalStateException::class.java) { DeviceSeeds.promote(vault, "other-owner", fingerprint(old), fingerprint(replacement)) }
        assertArrayEquals(old, vault.get("device:owner")); assertArrayEquals(replacement, vault.get("device-candidate:owner"))
    }

    @Test fun failedCommitPreservesBothSlotsForRecovery() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = SecretVault(context) { key }
        val old = ByteArray(32) { 1 }; val next = ByteArray(32) { 2 }
        vault.put("device:owner", old); vault.put("device-candidate:owner", next)
        val failing = SecretVault(context, commit = { false }) { key }
        assertThrows(IllegalStateException::class.java) { DeviceSeeds.promote(failing, "owner", fingerprint(old), fingerprint(next)) }
        assertArrayEquals(old, vault.get("device:owner")); assertArrayEquals(next, vault.get("device-candidate:owner"))
    }

    @Test fun candidatePreparationNeverReplacesTheActiveOrExistingCandidate() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = SecretVault(context) { key }; val old = ByteArray(32) { 1 }
        vault.put("device:owner", old)
        val first = DeviceSeeds.candidate(vault, "owner"); val second = DeviceSeeds.candidate(vault, "owner")
        assertArrayEquals(first, second); assertArrayEquals(old, vault.get("device:owner"))
    }
}
