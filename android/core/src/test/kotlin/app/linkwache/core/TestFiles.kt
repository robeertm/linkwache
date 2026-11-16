package app.linkwache.core

import java.io.File

object TestFiles {
    val repo: File = File(System.getProperty("linkwache.repo") ?: "../..")
    val android: File = File(System.getProperty("linkwache.android") ?: "..")
    fun read(rel: String): String = File(repo, rel).readText()
}
