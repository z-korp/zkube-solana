package com.zkorp.zkube.unitywallet

import android.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
class ClientStoreTest {
    private val owner = Base64.encodeToString(ByteArray(32) { 7 }, Base64.NO_WRAP)
    @Test fun publicLocatorsRemainIndependentOfSecretLossAndAreOwnerScoped() {
        val context = RuntimeEnvironment.getApplication()
        ClientStore.write(context, owner, "campaign", "synthetic locator")
        ClientStore.write(context, owner, "daily", "separate slot")
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        SecretVault(context) { key }.put("device:$owner", ByteArray(32) { 9 })
        assertNull(SecretVault(context) { throw IllegalStateException("Synthetic key loss") }.get("device:$owner"))
        assertEquals("synthetic locator", ClientStore.read(context.applicationContext, owner, "campaign"))
        assertEquals("separate slot", ClientStore.read(context.applicationContext, owner, "daily"))
        assertNull(ClientStore.read(context, Base64.encodeToString(ByteArray(32) { 8 }, Base64.NO_WRAP), "campaign"))
        ClientStore.write(context, owner, "campaign", null)
        assertNull(ClientStore.read(context, owner, "campaign"))
        assertEquals("separate slot", ClientStore.read(context, owner, "daily"))
    }
    @Test fun concurrentJournalWritersCannotReplaceAnUnresolvedIntent() {
        val context = RuntimeEnvironment.getApplication()
        ClientStore.write(context, owner, "journal", null)
        val pool = Executors.newFixedThreadPool(4)
        try {
            val outcomes = pool.invokeAll((1..16).map { index -> Callable {
                ClientStore.compareExchange(context, owner, "journal", null, "intent-$index")
            } }).map { it.get() }
            assertEquals(1, outcomes.count { it })
            val saved = ClientStore.read(context, owner, "journal")
            assertFalse(ClientStore.compareExchange(context, owner, "journal", "wrong", null))
            assertEquals(saved, ClientStore.read(context, owner, "journal"))
            assertTrue(ClientStore.compareExchange(context, owner, "journal", saved, null))
        } finally { pool.shutdownNow() }
    }
}
