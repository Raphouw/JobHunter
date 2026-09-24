from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TASK_LAUNCHERS_DIR = ROOT / "scheduled_tasks"


def slug(value: str) -> str:
    import re
    import unicodedata

    value = "".join(char for char in unicodedata.normalize("NFD", value) if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_") or "profil"


def task_name(profile: str) -> str:
    return f"StageHunter_{slug(Path(profile).stem)}"


def ensure_windows() -> None:
    if os.name != "nt":
        raise RuntimeError("La planification automatique est disponible sous Windows.")


def launcher_path(profile: str) -> Path:
    """Return a short task action so schtasks /TR stays below 261 characters."""
    return TASK_LAUNCHERS_DIR / f"{task_name(profile)}.cmd"


def write_launcher(profile: str) -> Path:
    python = ROOT / ".venv" / "Scripts" / "python.exe"
    profile_path = Path(profile).resolve()
    if not python.exists():
        raise RuntimeError("Environnement .venv introuvable. Lance install.bat.")
    if not profile_path.exists():
        raise RuntimeError(f"Profil introuvable : {profile_path}")
    TASK_LAUNCHERS_DIR.mkdir(parents=True, exist_ok=True)
    launcher = launcher_path(profile)
    content = (
        "@echo off\r\n"
        "chcp 65001 >nul\r\n"
        "set \"PYTHONUTF8=1\"\r\n"
        "set \"PYTHONIOENCODING=utf-8\"\r\n"
        "set \"NO_COLOR=1\"\r\n"
        f'cd /d "{ROOT}"\r\n'
        f'"{python}" "{ROOT / "stage_hunter.py"}" scan --profile "{profile_path}"\r\n'
        "exit /b %errorlevel%\r\n"
    )
    launcher.write_text(content, encoding="utf-8")
    return launcher


def run_schtasks(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    # ``schtasks`` writes in the active Windows OEM code page, not UTF-8.
    # The explicit ``oem`` codec avoids mojibake such as ``Erreur�``.
    return subprocess.run(
        ["schtasks", *arguments],
        capture_output=True,
        text=True,
        encoding="oem" if os.name == "nt" else "utf-8",
        errors="replace",
    )


def install(profile: str, at: str, frequency: str) -> str:
    ensure_windows()
    launcher = write_launcher(profile)
    # /TR is limited to 261 characters. The launcher contains the long Python,
    # script and profile paths; Task Scheduler only receives this short path.
    command = f'"{launcher}"'
    if len(command) > 261:
        raise RuntimeError(
            "Le chemin d'installation reste trop long pour le Planificateur Windows. "
            "Déplace Stage Hunter dans un dossier plus court, par exemple C:\\StageHunter."
        )
    schedule = {"daily": "DAILY", "weekdays": "WEEKLY", "weekly": "WEEKLY"}[frequency]
    args = ["/Create", "/TN", task_name(profile), "/TR", command, "/SC", schedule, "/ST", at, "/F"]
    if frequency == "weekdays":
        args += ["/D", "MON,TUE,WED,THU,FRI"]
    elif frequency == "weekly":
        args += ["/D", "MON"]
    result = run_schtasks(args)
    if result.returncode:
        raise RuntimeError((result.stdout + "\n" + result.stderr).strip())
    return f"Tâche {task_name(profile)} créée ({frequency}, {at})."


def remove(profile: str) -> str:
    ensure_windows()
    result = run_schtasks(["/Delete", "/TN", task_name(profile), "/F"])
    if result.returncode:
        raise RuntimeError((result.stdout + "\n" + result.stderr).strip())
    launcher_path(profile).unlink(missing_ok=True)
    return f"Tâche {task_name(profile)} supprimée."


def status(profile: str) -> dict:
    if os.name != "nt":
        return {"supported": False, "installed": False, "message": "Windows requis"}
    result = run_schtasks(["/Query", "/TN", task_name(profile), "/FO", "LIST", "/V"])
    return {"supported": True, "installed": result.returncode == 0, "details": result.stdout.strip() if result.returncode == 0 else ""}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["install", "remove", "status"])
    parser.add_argument("--profile", required=True)
    parser.add_argument("--at", default="07:00")
    parser.add_argument("--frequency", choices=["daily", "weekdays", "weekly"], default="daily")
    args = parser.parse_args()
    if args.command == "install":
        print(install(args.profile, args.at, args.frequency))
    elif args.command == "remove":
        print(remove(args.profile))
    else:
        print(json.dumps(status(args.profile), ensure_ascii=False))


if __name__ == "__main__":
    main()
