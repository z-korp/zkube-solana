package com.zkorp.zkube.unitywallet

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
class InstallKeyTest {
    @Test fun oneInstallKeyIsSavedBeforeUseAndReusedAfterRestart() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        var commits = 0
        val vault = SecretVault(context, commit = { commits++; it.commit() }) { key }
        val first = DeviceSeeds.load(vault, true)!!
        assertEquals(32, first.size)
        assertArrayEquals(first, vault.get("device"))
        assertArrayEquals(first, DeviceSeeds.load(vault, true))
        assertArrayEquals(first, DeviceSeeds.load(SecretVault(context) { key }, false))
        assertEquals(1, commits)
        first.fill(0)
        assertFalse(DeviceSeeds.load(vault, false)!!.all { it == 0.toByte() })
    }

    @Test fun readOnlyLookupDoesNotCreateAKey() {
        val vault = SecretVault(RuntimeEnvironment.getApplication()) { throw AssertionError("No key creation") }
        assertNull(DeviceSeeds.load(vault, false))
    }

    @Test fun failedDurableSaveReturnsNoUsableKey() {
        val context = RuntimeEnvironment.getApplication()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val failing = SecretVault(context, commit = { false }) { key }
        assertThrows(IllegalStateException::class.java) { DeviceSeeds.load(failing, true) }
        assertNull(SecretVault(context) { key }.get("device"))
    }
}
