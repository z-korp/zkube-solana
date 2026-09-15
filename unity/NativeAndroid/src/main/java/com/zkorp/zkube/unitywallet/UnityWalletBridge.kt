package com.zkorp.zkube.unitywallet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import java.security.MessageDigest

object UnityWalletBridge {
    @JvmStatic fun start(activity: Activity, requestJson: String, callback: BridgeCallback) {
        require(requestJson.length <= 8192)
        val request = JSONObject(requestJson)
        val id = request.getString("requestId")
        require(id.length in 1..80)
        try {
            PendingWalletRequests.add(id, requestJson, callback)
            activity.runOnUiThread {
                try { activity.startActivity(Intent(activity, WalletActivity::class.java).putExtra("requestId", id)) }
                catch (_: Exception) { PendingWalletRequests.complete(id, failure(id, "activity-unavailable")) }
            }
        } catch (cause: WalletFailure) { callback.onComplete(failure(id, cause.code)) }
    }

    @JvmStatic fun loadDeviceSeed(context: Context, owner: String): String? {
        validateOwner(owner)
        return SecretVault(context).get("device:$owner")?.let { Base64.encodeToString(it, Base64.NO_WRAP) }
    }

    @JvmStatic fun createDeviceSeed(context: Context, owner: String): String {
        validateOwner(owner)
        val seed = DeviceSeeds.getOrCreate(SecretVault(context), owner)
        return Base64.encodeToString(seed, Base64.NO_WRAP)
    }

    @JvmStatic fun removeDeviceSeed(context: Context, owner: String) { validateOwner(owner); DeviceSeeds.remove(SecretVault(context), owner) }
    @JvmStatic fun loadCandidateSeed(context: Context, owner: String): String? {
        validateOwner(owner)
        return SecretVault(context).get("device-candidate:$owner")?.let { Base64.encodeToString(it, Base64.NO_WRAP) }
    }
    @JvmStatic fun createCandidateSeed(context: Context, owner: String): String {
        validateOwner(owner)
        return Base64.encodeToString(DeviceSeeds.candidate(SecretVault(context), owner), Base64.NO_WRAP)
    }
    @JvmStatic fun promoteCandidateSeed(context: Context, owner: String, activeFingerprint: String?, candidateFingerprint: String) {
        validateOwner(owner)
        DeviceSeeds.promote(SecretVault(context), owner, activeFingerprint?.let(::decode32), decode32(candidateFingerprint))
    }
    private fun validateOwner(owner: String) { decode32(owner) }
    private fun decode32(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP).also {
        require(it.size == 32 && Base64.encodeToString(it, Base64.NO_WRAP) == value)
    }
}

internal object DeviceSeeds {
    // All JNI callers share this lock, even though they create separate vault
    // adapters. An existing signer is never replaced by a concurrent startup.
    @Synchronized fun getOrCreate(vault: SecretVault, owner: String): ByteArray =
        vault.get("device:$owner") ?: ByteArray(32).also { SecureRandom().nextBytes(it); vault.put("device:$owner", it) }
    @Synchronized fun remove(vault: SecretVault, owner: String) = vault.remove("device:$owner")
    @Synchronized fun candidate(vault: SecretVault, owner: String): ByteArray =
        vault.get("device-candidate:$owner") ?: ByteArray(32).also { SecureRandom().nextBytes(it); vault.put("device-candidate:$owner", it) }

    @Synchronized fun promote(vault: SecretVault, owner: String, expectedActive: ByteArray?, expectedCandidate: ByteArray) {
        require(expectedActive == null || expectedActive.size == 32)
        require(expectedCandidate.size == 32)
        val active = vault.get("device:$owner")
        val candidate = vault.get("device-candidate:$owner")
        try {
            fun matches(seed: ByteArray?, fingerprint: ByteArray?): Boolean {
                if (seed == null || fingerprint == null) return seed == null && fingerprint == null
                require(seed.size == 32)
                return MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(seed), fingerprint)
            }
            // A crash after the encrypted commit but before public metadata/journal
            // completion must resume without generating or replacing any key.
            if (candidate == null && matches(active, expectedCandidate)) return
            check(matches(active, expectedActive) && matches(candidate, expectedCandidate)) { "Device seed snapshot changed" }
            check(candidate != null)
            vault.putAndRemove("device:$owner", candidate, "device-candidate:$owner")
        } finally { active?.fill(0); candidate?.fill(0) }
    }
}

internal fun failure(id: String, code: String) = JSONObject().put("requestId", id).put("ok", false).put("error", code).toString()
