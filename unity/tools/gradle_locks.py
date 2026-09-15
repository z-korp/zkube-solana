#!/usr/bin/env python3
"""Resolve/check the selected Unity identity's strict Android dependency locks.

ExportAndroidForLocks is the existing build.py exec action. --write-locks is
explicit source mutation for dependency review; normal builds never resolve new
locks. The marker binds the selected identity to the actual generated project.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import build
from android_identity import identity
from editor_lease import editor_lease


def validate_export(export, profile, project):
    if not (export / 'settings.gradle').is_file():
        raise RuntimeError('A generated Unity Android Gradle project is required')
    marker = json.loads((export / 'zkube-identity.json').read_text())
    if marker != profile:
        raise RuntimeError('Export identity differs from the requested dependency closure')
    wallet = export / 'unityLibrary/zkube-wallet.gradle'
    if profile['name'] == 'store':
        if wallet.exists() or 'zkube-wallet.gradle' in (export / 'unityLibrary/build.gradle').read_text():
            raise RuntimeError('Store export contains wallet dependencies')
    else:
        declared = json.loads((project / 'NativeAndroid/dependencies.json').read_text())['runtime']
        exported = re.findall(r"implementation '([^']+)'", wallet.read_text())
        if exported != declared:
            raise RuntimeError('Generated wallet dependencies are stale; export again')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-locks', action='store_true')
    parser.add_argument('--identity', choices=['money', 'store'], default='money')
    parser.add_argument('--export', type=Path, help='Explicit export inside build/unity; default current Bee project')
    args = parser.parse_args()
    project, output = build.PROJECT, build.OUTPUT
    with editor_lease():
        _, android = build.toolchain()
        profile = identity(build.LOCK, args.identity)
        export = project / 'Library/Bee/Android/Prj/IL2CPP/Gradle'
        if args.export is not None:
            export = args.export.resolve()
            if not export.is_relative_to(output.resolve()):
                raise RuntimeError('--export must stay inside build/unity')
        validate_export(export, profile, project)
        for module in ('launcher', 'unityLibrary'):
            target = export / module
            source = project / profile['locks'] / module / 'gradle.lockfile'
            if not args.write_locks and not source.is_file():
                raise RuntimeError(f'Missing reviewed lock: {source}')
            if source.is_file():
                shutil.copyfile(source, target / 'gradle.lockfile')
            else:
                (target / 'gradle.lockfile').unlink(missing_ok=True)
            shutil.copyfile(project / 'NativeAndroid/unity-dependencies.gradle',
                            target / 'zkube-dependencies.gradle')
            gradle_file = target / 'build.gradle'
            include = "apply from: 'zkube-dependencies.gradle'"
            if include not in gradle_file.read_text():
                with gradle_file.open('a') as stream:
                    stream.write('\n' + include + '\n')
        env = {key: value for key, value in os.environ.items()
               if key in {'HOME', 'USER', 'LANG', 'LC_ALL', 'PATH', 'GRADLE_USER_HOME'}}
        env.update(NO_DNA='1', JAVA_HOME=str(android / 'OpenJDK'), ANDROID_HOME=str(android / 'SDK'))
        command = [str(android / 'OpenJDK/bin/java'), '-classpath',
                   str(android / 'Tools/gradle/lib' / f"gradle-launcher-{build.LOCK['gradle']}.jar"),
                   'org.gradle.launcher.GradleMain', '--no-daemon', '--console=plain',
                   ':launcher:zkubeResolveLockedDependencies', ':unityLibrary:zkubeResolveLockedDependencies']
        if args.write_locks:
            command.append('--write-locks')
        subprocess.run(command, cwd=export, env=env, check=True)
        # Validate the entire result before changing either reviewed source file.
        locks = {module: (export / module / 'gradle.lockfile').read_text()
                 for module in ('launcher', 'unityLibrary')}
        if profile['name'] == 'store' and any(re.search(r'(?mi)^com\.solana(?:mobile)?[.:]', value)
                                              for value in locks.values()):
            raise RuntimeError('Store dependency closure unexpectedly includes Solana')
        if args.write_locks:
            for module, contents in locks.items():
                destination = project / profile['locks'] / module / 'gradle.lockfile'
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(contents)
        print(f"Unity {args.identity} compile/runtime locks resolved for both Gradle variants")


if __name__ == '__main__':
    from cli import run_main
    run_main(main)
