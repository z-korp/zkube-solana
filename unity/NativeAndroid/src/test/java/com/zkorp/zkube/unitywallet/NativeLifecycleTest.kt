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
import java.util.concurrent.Executors
import java.util.concurrent.Callable

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

    @Test fun concurrentStartupCannotReplaceTheDeviceSigner() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val workers = Executors.newFixedThreadPool(8)
        try {
            val seeds = workers.invokeAll((1..32).map { Callable {
                DeviceSeeds.getOrCreate(SecretVault(context) { key }, "concurrent-owner").toList()
            } }).map { it.get() }
            assertEquals(1, seeds.toSet().size)
            assertEquals(32, seeds.singleOrNull()?.size ?: seeds.first().size)
        } finally { workers.shutdownNow() }
    }
}
