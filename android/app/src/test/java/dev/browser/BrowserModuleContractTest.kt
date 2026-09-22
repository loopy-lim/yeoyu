package dev.browser

import com.facebook.react.bridge.ReactMethod
import org.junit.Assert.*
import org.junit.Test

class BrowserModuleContractTest {
    @Test fun asyncExportsHaveJvmVoidReturnTypes() {
        for (module in listOf(BrowserModule::class.java, BrowserExtensionsModule::class.java)) {
            val methods = module.declaredMethods.filter { it.getAnnotation(ReactMethod::class.java) != null }
            assertTrue("${module.simpleName} must expose methods", methods.isNotEmpty())
            for (method in methods) {
                if (!method.getAnnotation(ReactMethod::class.java).isBlockingSynchronousMethod) {
                    assertEquals("${module.simpleName}.${method.name} must return void for TurboModule interop", Void.TYPE, method.returnType)
                }
            }
        }
    }
}
