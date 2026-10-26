import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// El workflow de GitHub pasa un VERSION_CODE creciente en cada ejecución.
val abacoVersionCode = providers.gradleProperty("VERSION_CODE")
    .orElse(providers.environmentVariable("GITHUB_RUN_NUMBER"))
    .orElse("2")
    .get()
    .toInt()
val abacoVersionName = providers.gradleProperty("VERSION_NAME")
    .orElse("1.0.$abacoVersionCode")
    .get()

android {
    namespace = "mx.abaco.app"
    compileSdk = 35

    defaultConfig {
        // No cambiar: Android usa este ID para reconocer la app ya instalada.
        applicationId = "mx.abaco.app"
        minSdk = 24
        targetSdk = 35
        versionCode = abacoVersionCode
        versionName = abacoVersionName
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("ABACO_RELEASE_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ABACO_RELEASE_STORE_PASSWORD")
                keyAlias = System.getenv("ABACO_RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("ABACO_RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            // Solo se firma con la clave persistente configurada como secreto en GitHub.
            if (!System.getenv("ABACO_RELEASE_KEYSTORE_PATH").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")
}

// Fuentes web separadas: se copian juntas para mantener rutas relativas en WebView.
tasks.register<Copy>("copyAbacoWebAssets") {
    from(rootProject.file("index.html"))
    from(rootProject.file("styles.css"))
    from(rootProject.file("js")) { into("js") }
    into(layout.projectDirectory.dir("src/main/assets"))
}

tasks.named("preBuild") {
    dependsOn("copyAbacoWebAssets")
}
