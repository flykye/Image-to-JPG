# Synthetic HEIC fixture

`heic-rotation.heic` is a 1,378-byte synthetic image generated locally on 2026-11-14, with no user photograph or personal metadata.

The source is a 320×200 RGB image with four flat-colour quadrants: red/green on the top row and blue/yellow on the bottom row. It was encoded as a quality-100 JPEG with EXIF orientation 6, then converted using macOS `sips -s format heic -s formatOptions 95`. The HEIC contains an `irot` transform; correctly decoded pixels are 200×320, with blue/red at the top and yellow/green at the bottom.

It exercises real WASM HEVC decoding, rotation handling and native JPEG encoding without requiring ImageMagick or macOS in the test runner. It may be freely copied and modified with the repository's licence.
