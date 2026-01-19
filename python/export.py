import json
import os
from pathlib import Path

# ПУТИ
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
REPLAYS_DIR = PROJECT_ROOT / "replays"
OUTPUT_FILE = PROJECT_ROOT / "frontend" / "data.js"

def get_replay_folders():
    # Возвращает список папок с реплеями (имя папки = сигнатура карты)
    return [f for f in REPLAYS_DIR.iterdir() if f.is_dir()]

def merge_sessions(folder_path):
    # Находим все .jsonl файлы в папке конкретной игры
    session_files = sorted(folder_path.glob("session_*.jsonl"), key=lambda p: p.stat().st_mtime)
    
    if not session_files:
        return None

    print(f"[*] Найдено {len(session_files)} файлов сессий в {folder_path.name}")
    
    final_header = None
    # Словарь: { номер_хода: объект_хода }
    # Использование словаря автоматически убирает дубликаты. 
    # Так как мы читаем файлы по возрастанию времени, более поздняя запись хода перезапишет старую.
    merged_turns_dict = {}

    for s_file in session_files:
        print(f"   -> Чтение: {s_file.name}")
        try:
            with open(s_file, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        obj = json.loads(line)
                        dtype = obj.get("type")
                        
                        if dtype == "HEADER":
                            # Всегда берем хедер из последнего файла (он самый свежий)
                            # или из первого, если они идентичны.
                            final_header = obj
                        elif dtype == "TURN":
                            t_num = obj.get("turn")
                            if t_num is not None:
                                merged_turns_dict[t_num] = obj
                                
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            print(f"[ERROR] Не удалось прочитать {s_file}: {e}")

    # Превращаем словарь обратно в список и сортируем
    sorted_turns = [merged_turns_dict[k] for k in sorted(merged_turns_dict.keys())]
    
    return {"header": final_header, "turns": sorted_turns}

def export_latest_replay():
    folders = get_replay_folders()
    if not folders:
        print("[ERROR] Папка replays пуста.")
        return

    # Выбираем папку, в которой был изменен файл сессии последним
    latest_folder = max(folders, key=lambda d: d.stat().st_mtime)
    print(f"[*] Выбрана последняя игра: {latest_folder.name}")

    replay_data = merge_sessions(latest_folder)
    
    if not replay_data or not replay_data["header"]:
        print("[ERROR] Не удалось собрать данные реплея.")
        return

    print(f"[*] Сборка завершена. Всего ходов: {len(replay_data['turns'])}")
    
    # Запись в JS
    try:
        json_str = json.dumps(replay_data, ensure_ascii=False)
        js_content = f"window.REPLAY_DATA = {json_str};"

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(js_content)
            
        print(f"[SUCCESS] Успешно экспортировано в {OUTPUT_FILE}")
    except Exception as e:
        print(f"[ERROR] Ошибка записи файла: {e}")

if __name__ == "__main__":
    export_latest_replay()