pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "linkwache-android"
include(":core")
// The Android modules need the Android SDK; the pure Kotlin core also builds without it
// (e.g. on machines where only the core tests run: -PcoreOnly).
if (!providers.gradleProperty("coreOnly").isPresent) {
    include(":app", ":fakebrowser")
}
