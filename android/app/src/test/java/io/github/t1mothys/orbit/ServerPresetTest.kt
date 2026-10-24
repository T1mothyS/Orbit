package io.github.t1mothys.orbit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerPresetTest {
    @Test fun productionIsDefaultAndUnknownInputCannotChooseAnOrigin() {
        assertEquals(ServerPreset.PRODUCTION, ServerPreset.fromId(null))
        assertEquals(ServerPreset.PRODUCTION, ServerPreset.fromId("https://attacker.invalid"))
        assertEquals(ServerPreset.STAGING, ServerPreset.fromId("staging"))
    }
    @Test fun activeOriginAloneReceivesTheBridge() {
        val production = WebOriginPolicy(ServerEnvironment.url(ServerPreset.PRODUCTION))
        val staging = WebOriginPolicy(ServerEnvironment.url(ServerPreset.STAGING))
        assertTrue(production.permits(ServerEnvironment.origin(ServerPreset.PRODUCTION), true))
        assertTrue(staging.permits(ServerEnvironment.origin(ServerPreset.STAGING), true))
        assertFalse(production.permits(ServerEnvironment.origin(ServerPreset.STAGING), true))
        assertFalse(staging.permits(ServerEnvironment.origin(ServerPreset.PRODUCTION), true))
        assertFalse(staging.permits(ServerEnvironment.origin(ServerPreset.STAGING), false))
    }
}
