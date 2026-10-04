package com.zkorp.zkube.unitywallet

import android.content.Context
import android.content.Intent
import android.os.Bundle
import org.robolectric.RuntimeEnvironment
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
class NativeLifecycleTest {
    @Test fun activityRecreationCancelsWithoutLaunchingAWallet() {
        val results = mutableListOf<String>()
        PendingWalletRequests.add("recreated", "{}", BridgeCallback { results += it })
        val intent = Intent(RuntimeEnvironment.getApplication(), WalletActivity::class.java).putExtra("requestId", "recreated")
        val controller = Robolectric.buildActivity(WalletActivity::class.java, intent).create(Bundle())
        assertTrue(results.single().contains("activity-recreated"))
        assertNull(shadowOf(controller.get()).nextStartedActivity)
        controller.destroy()
    }

    @Test fun processLossNeverRelaunchesAnUnknownRequest() {
        val intent = Intent(RuntimeEnvironment.getApplication(), WalletActivity::class.java).putExtra("requestId", "lost-process")
        val controller = Robolectric.buildActivity(WalletActivity::class.java, intent).create()
        assertTrue(controller.get().isFinishing)
        assertNull(shadowOf(controller.get()).nextStartedActivity)
        controller.destroy()
    }

    @Test fun vaultEncryptsBindsNamesAndFailsClosedAfterKeyLoss() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = SecretVault(context) { key }
        val secret = ByteArray(32) { (it + 1).toByte() }
        vault.put("device:a", secret)
        val prefs = context.getSharedPreferences("zkube-unity-secrets-v1", Context.MODE_PRIVATE)
        val first = prefs.getString("device:a", null)!!
        assertFalse(first.contains(String(secret)))
        assertArrayEquals(secret, vault.get("device:a"))
        vault.put("device:a", secret)
        assertNotEquals(first, prefs.getString("device:a", null))
        prefs.edit().putString("device:b", first).commit()
        assertNull(vault.get("device:b"))
        assertNotNull(vault.get("device:a"))
        val changedKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull(SecretVault(context) { changedKey }.get("device:a"))
        assertNull(prefs.getString("device:a", null))
    }

    @Test fun savedAuthorizationGivesBackItsAddressUntilForgottenAndDropsAnEntryItCannotRead() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = SecretVault(context) { key }
        assertNull(SavedAuthorization.owner(vault))
        val owner = android.util.Base64.encodeToString(ByteArray(32) { 7 }, android.util.Base64.NO_WRAP)
        SavedAuthorization.save(vault, owner, "token")
        // A restart builds a new vault over the same storage.
        assertEquals(owner, SavedAuthorization.owner(SecretVault(context) { key }))
        assertEquals("token", SavedAuthorization.load(vault)!!.getString("authToken"))
        SavedAuthorization.forget(vault)
        assertNull(SavedAuthorization.owner(SecretVault(context) { key }))
        for (stale in listOf("{}", "not json", "{\"owner\":\"AAAA\",\"authToken\":\"token\"}", "{\"owner\":\"$owner\",\"authToken\":\"\"}")) {
            vault.put("wallet-authorization", stale.toByteArray(Charsets.UTF_8))
            assertNull(stale, SavedAuthorization.owner(vault))
            assertNull(stale, vault.get("wallet-authorization"))
        }
    }

}
