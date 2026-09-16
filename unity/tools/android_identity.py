"""Read the single Android identity/ABI authority; no build side effects."""
from pathlib import PurePosixPath


def identity(toolchain, name):
    try:
        return _identity(toolchain, name)
    except (KeyError, TypeError) as error:
        raise RuntimeError('Malformed Android identity configuration: ' + str(error)) from None


def _identity(toolchain, name):
    matches = [item for item in toolchain['androidIdentities'] if item['name'] == name]
    if len(matches) != 1 or name not in ('money', 'store'):
        raise RuntimeError('Unknown or duplicate Android identity: ' + name)
    profile = matches[0]
    expected = ('com.zkorp.zkube.store', 'aab', ['arm64-v8a', 'x86_64']) if name == 'store' else (
        'com.zkorp.zkube', 'apk', ['arm64-v8a'])
    if (profile['package'], profile['format'], profile['abis']) != expected:
        raise RuntimeError('Android identity does not match its approved distribution contract')
    if not isinstance(profile['productName'], str) or not profile['productName'].strip():
        raise RuntimeError('Android identity requires a display name')
    lock_path = PurePosixPath(profile['locks'])
    if lock_path.is_absolute() or '..' in lock_path.parts or not lock_path.parts:
        raise RuntimeError('Android lock directory must stay within the Unity project')
    if len({p['locks'] for p in toolchain['androidIdentities']}) != len(toolchain['androidIdentities']):
        raise RuntimeError('Android identities must not share dependency locks')
    return profile


def abis(toolchain, profile):
    try:
        return _abis(toolchain, profile)
    except (KeyError, TypeError) as error:
        raise RuntimeError('Malformed Android ABI configuration: ' + str(error)) from None


def _abis(toolchain, profile):
    result = []
    for name in profile['abis']:
        matches = [item for item in toolchain['androidAbis'] if item['name'] == name]
        if len(matches) != 1:
            raise RuntimeError('Missing or duplicate Android ABI: ' + name)
        result.append(matches[0])
    return result
