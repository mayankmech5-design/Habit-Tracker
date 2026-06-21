if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/Mayank/.gradle/caches/8.14.3/transforms/cdc1c6fc4522dd8e986b4c663c544a25/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Mayank/.gradle/caches/8.14.3/transforms/cdc1c6fc4522dd8e986b4c663c544a25/transformed/hermes-android-0.81.5-release/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

