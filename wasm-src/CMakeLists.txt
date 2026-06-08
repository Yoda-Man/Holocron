cmake_minimum_required(VERSION 3.20)
project(layout_engine
  VERSION 1.0.0
  DESCRIPTION "Holocron VR WASM Layout Engine — force-directed graph layout"
  LANGUAGES CXX
)

# ─── C++ Standard ────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── Emscripten Toolchain Detection ──────────────────────────────────────
# Build with:
#   emcmake cmake -B build/wasm
#   cmake --build build/wasm
#
# Or set CMAKE_TOOLCHAIN_FILE explicitly:
#   cmake -B build/wasm \
#     -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR
    "Emscripten toolchain is required. Build with:\n"
    "  emcmake cmake -B build/wasm\n"
    "or set -DCMAKE_TOOLCHAIN_FILE to Emscripten.cmake"
  )
endif()

# ─── Source Files ────────────────────────────────────────────────────────
set(WASM_SOURCES
  layout_engine.cpp
  force_directed.h
  macro_layout.h
)

# ─── Output Configuration ────────────────────────────────────────────────
# The module (.mjs + .wasm) is placed in frontend/ so the Web Worker
# (layoutWorker.js) can import it relative to the plugin root.
set(WASM_OUTPUT_DIR "${CMAKE_SOURCE_DIR}/../frontend")
set(WASM_OUTPUT_NAME "layout_engine")

# ─── Compile Definitions ─────────────────────────────────────────────────
add_compile_definitions(
  PLUGIN_VERSION="${PROJECT_VERSION}"
)

# ─── Executable Target ───────────────────────────────────────────────────
# Emscripten compiles C/C++ to WASM via the add_executable path.
add_executable(${WASM_OUTPUT_NAME}
  ${CMAKE_CURRENT_SOURCE_DIR}/layout_engine.cpp
)

# ─── Compile Flags ───────────────────────────────────────────────────────
target_compile_options(${WASM_OUTPUT_NAME} PRIVATE
  $<$<CONFIG:Release>:
    -O3
    -flto
    -msimd128
  >
  $<$<CONFIG:Debug>:
    -O0
    -g
    -sASSERTIONS=2
    -fsanitize=address
  >
)

# ─── Link Flags (04-WASM-Spec.md §7.2) ───────────────────────────────────
target_link_options(${WASM_OUTPUT_NAME} PRIVATE

  # ── Optimisation ─────────────────────────────────────────────────────
  $<$<CONFIG:Release>:-O3>
  $<$<CONFIG:Release>:-flto>
  -msimd128                              # WASM SIMD (2× speedup on float ops)

  # ── Module Format ────────────────────────────────────────────────────
  -s WASM=1                              # Output WASM (not asm.js)
  -s MODULARIZE=1                        # ES module wrapper
  -s EXPORT_ES6=1                        # ES6 module format

  # ── Environment ──────────────────────────────────────────────────────
  -s ENVIRONMENT='worker'                # Optimise for Web Worker context

  # ── Memory Limits ────────────────────────────────────────────────────
  -s INITIAL_MEMORY=33554432             # 32 MB initial heap
  -s MAXIMUM_MEMORY=52428800             # 50 MB maximum heap
  -s ALLOW_MEMORY_GROWTH=1              # Allow dynamic growth up to max

  # ── Exported Functions (04-WASM-Spec.md §7.2) ────────────────────────
  -s EXPORTED_FUNCTIONS='[
    "_init_graph",
    "_get_node_input_ptr",
    "_get_edge_input_ptr",
    "_compute_layout",
    "_get_positions_ptr",
    "_update_positions",
    "_get_node_count",
    "_free_memory",
    "_set_convergence_threshold",
    "_set_repulsion_k",
    "_set_attraction_k",
    "_set_damping",
    "_set_max_iterations",
    "_set_scene_radius"
  ]'

  # ── Runtime Methods ──────────────────────────────────────────────────
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]'

  # ── Output Path ──────────────────────────────────────────────────────
  -o "${WASM_OUTPUT_DIR}/${WASM_OUTPUT_NAME}.mjs"
)

# ─── Include Paths ───────────────────────────────────────────────────────
target_include_directories(${WASM_OUTPUT_NAME} PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
)

# ─── Custom Target: Clean WASM Outputs ──────────────────────────────────
set(CLEAN_FILES
  "${WASM_OUTPUT_DIR}/${WASM_OUTPUT_NAME}.mjs"
  "${WASM_OUTPUT_DIR}/${WASM_OUTPUT_NAME}.wasm"
  "${WASM_OUTPUT_DIR}/${WASM_OUTPUT_NAME}.map"
)
add_custom_target(clean-wasm
  COMMAND ${CMAKE_COMMAND} -E remove ${CLEAN_FILES}
  COMMENT "Removing WASM build artefacts from frontend/"
)
