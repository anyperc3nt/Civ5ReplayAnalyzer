import glob
import json
import os
from pathlib import Path

    
# ПУТИ
SCRIPT_DIR = Path(__file__).parent.resolve() # .../Civ5ReplayAnalyzer/python
PROJECT_ROOT = SCRIPT_DIR.parent           # .../Civ5ReplayAnalyzer

# Ищем папку replays в КОРНЕ проекта, а не внутри python
REPLAYS_DIR = PROJECT_ROOT / "replays"
OUTPUT_FILE = PROJECT_ROOT / "frontend" / "data.js"

  


def get_latest_session():
    # Ищем все файлы .jsonl рекурсивно
    all_files = list(REPLAYS_DIR.rglob("*.jsonl"))

    if not all_files:
        print(f"[DEBUG] Папка поиска: {REPLAYS_DIR.absolute()}")
        return None
    print(f"[DEBUG] Папка поиска: {REPLAYS_DIR.absolute()}")

    # Сортируем по времени изменения (mtime)
    # И берем самый свежий (последний в списке)
    latest_file = max(all_files, key=lambda p: p.stat().st_mtime)

    return latest_file


def export_replay():
    session_path = get_latest_session()
    if not session_path:
        print("[ERROR] Нет файлов реплеев!")
        return

    print(f"[*] Экспорт сессии: {session_path}")

    replay_data = {"header": None, "turns": []}

    try:
        with open(session_path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue

                try:
                    obj = json.loads(line)
                    if obj.get("type") == "HEADER":
                        replay_data["header"] = obj
                    elif obj.get("type") == "TURN":
                        replay_data["turns"].append(obj)
                except json.JSONDecodeError:
                    pass

        # Сортируем ходы (на всякий случай)
        replay_data["turns"].sort(key=lambda x: x["turn"])

        # Сохраняем как JS переменную
        json_str = json.dumps(replay_data, ensure_ascii=False)
        js_content = f"window.REPLAY_DATA = {json_str};"

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(js_content)

        print(f"[SUCCESS] Файл сохранен: {OUTPUT_FILE}")
        print(f"Ходов экспортировано: {len(replay_data['turns'])}")

    except Exception as e:
        print(f"[ERROR] Ошибка экспорта: {e}")


if __name__ == "__main__":
    export_replay()
