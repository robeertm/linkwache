#!/usr/bin/env python3
"""Regenerate desktop/core/tests/fixtures/updater/ with a throwaway minisign key.

The private key is thrown away after signing (never stored, never the release key).
Format: minisign "ED" (blake2b-512 prehashed ed25519) with trusted comment, as the Tauri
updater expects. Usage: python3 desktop/scripts/make_updater_fixture.py
"""
import base64, hashlib, os, sys
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

out = os.path.join(os.path.dirname(__file__), "..", "core", "tests", "fixtures", "updater")
os.makedirs(out, exist_ok=True)
b64 = lambda b: base64.b64encode(b).decode()

key = Ed25519PrivateKey.generate()
pk = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
kid = os.urandom(8)

def sign(data, comment):
    sig = key.sign(hashlib.blake2b(data).digest())
    gsig = key.sign(sig + comment.encode())
    return (f"untrusted comment: signature from linkwache test key\n{b64(b'ED' + kid + sig)}\n"
            f"trusted comment: {comment}\n{b64(gsig)}\n")

pub = f"untrusted comment: minisign public key (test only)\n{b64(b'Ed' + kid + pk)}\n"
art = b"linkwache-test-update-artefact 9.9.9\n" * 64
open(os.path.join(out, "test.pub"), "w").write(pub)
open(os.path.join(out, "artefact-9.9.9.bin"), "wb").write(art)
open(os.path.join(out, "artefact-9.9.9.bin.sig"), "w").write(sign(art, "timestamp:1 file:artefact-9.9.9.bin"))
# A second, unrelated key signs the same bytes (must be rejected under test.pub).
key = Ed25519PrivateKey.generate(); kid = os.urandom(8)
open(os.path.join(out, "artefact-9.9.9.bin.othersig"), "w").write(sign(art, "timestamp:1 file:artefact-9.9.9.bin"))
print("fixture written to", os.path.normpath(out))
