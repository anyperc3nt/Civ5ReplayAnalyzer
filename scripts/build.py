import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent 

# === КОНФИГУРАЦИЯ ПУТЕЙ ===
SCRIPT_DIR = Path(__file__).parent
FRONTEND_DIR = SCRIPT_DIR / "frontend"
PYTHON_DIR = SCRIPT_DIR / "python"
EXPORT_DIR = SCRIPT_DIR / "EXPORT"
DIST_DIR = SCRIPT_DIR / "dist"
BUILD_DIR = SCRIPT_DIR / "build"

# Файлы и папки из frontend, которые нужно копировать
FILES_TO_COPY = [
    "index.html",
    "data.js",
    "asset_map.js"
]
DIRS_TO_COPY = [
    "assets",
    "js"
]

def main():
    print("🚀 НАЧАЛО СБОРКИ...")

    # 1. Проверка наличия data.js (без него нет смысла собирать)
    if not (FRONTEND_DIR / "data.js").exists():
        print("❌ ОШИБКА: frontend/data.js не найден!")
        print("   Сначала запустите 'python python/export.py'")
        return

    # 2. Очистка предыдущей сборки
    if EXPORT_DIR.exists():
        print(f"🗑️  Удаление старой папки {EXPORT_DIR.name}...")
        shutil.rmtree(EXPORT_DIR)
    
    EXPORT_DIR.mkdir()

    # 3. Компиляция EXE через PyInstaller
    print("🔨 Компиляция PlayReplay.exe...")
    launcher_script = PYTHON_DIR / "launcher.py"
    
    # Запускаем PyInstaller как подпроцесс
    # --distpath и --workpath указываем, чтобы не мусорить в корне
    try:
        subprocess.check_call([
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--name", "PlayReplay",
            "--distpath", str(DIST_DIR),
            "--workpath", str(BUILD_DIR),
            "--specpath", str(BUILD_DIR),
            str(launcher_script)
        ])
    except subprocess.CalledProcessError:
        print("❌ ОШИБКА КОМПИЛЯЦИИ. Убедитесь, что pyinstaller установлен (pip install pyinstaller).")
        return

    # 4. Копирование файлов фронтенда
    print("📂 Копирование файлов игры...")
    
    # Файлы
    for fname in FILES_TO_COPY:
        src = FRONTEND_DIR / fname
        dst = EXPORT_DIR / fname
        if src.exists():
            shutil.copy2(src, dst)
        else:
            print(f"⚠️  Внимание: файл {fname} не найден и пропущен.")

    # Папки
    for dname in DIRS_TO_COPY:
        src = FRONTEND_DIR / dname
        dst = EXPORT_DIR / dname
        if src.exists():
            shutil.copytree(src, dst)
        else:
            print(f"⚠️  Внимание: папка {dname} не найдена и пропущена.")

    # 5. Перемещение EXE
    print("📦 Перемещение лаунчера...")
    exe_name = "PlayReplay.exe"
    if os.name != 'nt': # Если вдруг собираем на Linux/Mac
        exe_name = "PlayReplay"
    
    src_exe = DIST_DIR / exe_name
    dst_exe = EXPORT_DIR / exe_name

    if src_exe.exists():
        shutil.move(str(src_exe), str(dst_exe))
    else:
        print("❌ ОШИБКА: .exe файл не был создан!")
        return

    # 6. Создание ZIP архива (для отправки другу)
    print("🗜️  Создание архива EXPORT.zip...")
    shutil.make_archive(str(SCRIPT_DIR / "EXPORT"), 'zip', EXPORT_DIR)

    # 7. Очистка временных файлов сборки
    print("🧹 Очистка мусора...")
    if DIST_DIR.exists(): shutil.rmtree(DIST_DIR)
    if BUILD_DIR.exists(): shutil.rmtree(BUILD_DIR)

    print(f"\n✅ ГОТОВО! Папка с игрой: {EXPORT_DIR}")
    print(f"✅ Архив для отправки: {SCRIPT_DIR / 'EXPORT.zip'}")

if __name__ == "__main__":
    main()