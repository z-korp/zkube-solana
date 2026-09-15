package com.zkorp.zkube.unitywallet

import org.junit.Assert.*
import org.junit.Test

class WalletPolicyTest {
    @Test fun rejectsMissingVersionAndSignOnlyCapabilities() {
        assertFailure("unsupported-transaction-version") { WalletPolicy.requireCapabilities(listOf("legacy"), listOf(WalletPolicy.SIGN_TRANSACTIONS), null) }
        assertFailure("unsupported-transaction-version") { WalletPolicy.requireCapabilities(listOf(0.5), listOf(WalletPolicy.SIGN_TRANSACTIONS), null) }
        assertFailure("sign-only-unavailable") { WalletPolicy.requireCapabilities(listOf(0), emptyList(), null) }
        assertFailure("sign-only-unavailable") { WalletPolicy.requireCapabilities(listOf(0), listOf(WalletPolicy.SIGN_TRANSACTIONS), emptyList()) }
        WalletPolicy.requireCapabilities(listOf("legacy", 0), listOf(WalletPolicy.SIGN_TRANSACTIONS), listOf(WalletPolicy.SIGN_TRANSACTIONS))
    }

    @Test fun pinsTheAuthorizedAccountBeforeSigning() {
        WalletPolicy.requireAccount(ByteArray(32) { 1 }, ByteArray(32) { 1 })
        assertFailure("account-changed") { WalletPolicy.requireAccount(ByteArray(32) { 2 }, ByteArray(32) { 1 }) }
        assertFailure("account-changed") { WalletPolicy.requireAccount(ByteArray(31), null) }
    }

    @Test fun reauthorizationOrderCannotSwitchTheConnectedIdentity() {
        val owner = ByteArray(32) { 1 }
        val other = ByteArray(32) { 2 }
        assertEquals(1, WalletPolicy.selectAccount(listOf(other, owner), owner))
        assertEquals(0, WalletPolicy.selectAccount(listOf(owner, other), owner))
        assertFailure("account-changed") { WalletPolicy.selectAccount(listOf(other), owner) }
        assertFailure("account-changed") { WalletPolicy.selectAccount(emptyList(), null) }
    }

    @Test fun rejectionConsumesCallbackAndLateResultsCannotWin() {
        val results = mutableListOf<String>()
        PendingWalletRequests.add("rejection", "{}", BridgeCallback { results += it })
        assertFailure("wallet-busy") { PendingWalletRequests.add("second", "{}", BridgeCallback { fail() }) }
        PendingWalletRequests.complete("rejection", "rejected")
        PendingWalletRequests.complete("rejection", "late-signed-bytes")
        assertEquals(listOf("rejected"), results)
        assertNull(PendingWalletRequests.get("rejection"))
    }

    private fun assertFailure(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (cause: WalletFailure) { assertEquals(code, cause.code) }
    }
}
