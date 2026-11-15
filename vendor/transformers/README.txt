@huggingface/transformers 4.3.2: dist/transformers.min.js (a self-contained ES module) and its LICENSE.
onnxruntime-web 1.31.0-dev.20260914-8d85527a0: dist/ort-wasm-simd-threaded.asyncify.{mjs,wasm}, the runtime it loads (MIT).
Used by app/src/brain.worker.js, which points env.backends.onnx.wasm.wasmPaths here, so nothing but the
model's weights comes from outside. GitHub's push protection reads a string on line 40 of
transformers.min.js as a Mistral API key; it is model class names, and the owner allowed it.
