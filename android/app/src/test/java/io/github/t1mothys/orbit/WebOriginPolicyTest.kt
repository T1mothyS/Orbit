package io.github.t1mothys.orbit

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebOriginPolicyTest {
    private val policy = WebOriginPolicy("https://orbit.example.invalid/today")
    @Test fun fixedOriginMainFrameOnly() {
        assertTrue(policy.permits("https://orbit.example.invalid/assistant?conversation=123", true))
        assertTrue(policy.permits("https://orbit.example.invalid", true))
        assertFalse(policy.permits("https://orbit.example.invalid", false))
    }
    @Test fun rejectOriginAndCredentialConfusion() {
        for (url in listOf("http://orbit.example.invalid", "https://orbit.example.invalid.evil.test", "https://evil.test@orbit.example.invalid", "https://orbit.example.invalid:8443", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,test", "about:blank", "https://[invalid")) {
            assertFalse(url, policy.permits(url, true))
        }
    }
}
