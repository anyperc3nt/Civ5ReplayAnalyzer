import json
import os
from pathlib import Path

# --- НАСТРОЙКИ ---
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
REPLAYS_DIR = PROJECT_ROOT / "replays"
ASSETS_DIR = PROJECT_ROOT / "frontend" / "assets"
OUTPUT_FILE = PROJECT_ROOT / "frontend" / "asset_map.js"
ART_DEFINES_FILE = SCRIPT_DIR / "art_defines_dump.json" # Файл от xml_parser.py

# Какие категории из словаря игры мы хотим мапить на картинки
# Ключи здесь - это названия таблиц в базе данных Civ 5 (они же ключи в header.dictionary)
CATEGORIES_TO_MAP = [
    "units",
    "terrains",
    "features",     # Леса, оазисы
    "resources",    # Железо, пшеница
    "improvements", # Фермы, рудники
    "buildings",    # Здания и Чудеса
    "technologies", # (Если ты решишь добавить иконки технологий)
    "civilizations" # Иконки цивилизаций
]

def load_art_defines():
    if not ART_DEFINES_FILE.exists():
        print("[WARN] Файл art_defines_dump.json не найден. Запустите xml_parser.py!")
        return {}
    with open(ART_DEFINES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def get_latest_header():
    all_files = list(REPLAYS_DIR.rglob("*.jsonl"))
    if not all_files: return None
    latest = max(all_files, key=lambda p: p.stat().st_mtime)
    with open(latest, "r", encoding="utf-8") as f:
        for line in f:
            data = json.loads(line)
            if data.get("type") == "HEADER": return data
    return None

def generate_map():
    header = get_latest_header()
    if not header:
        print("Сначала запишите хотя бы один реплей!")
        return

    game_dict = header["dictionary"]
    art_defines = load_art_defines()
    
    # 1. Индексируем ВСЕ файлы в assets, где бы они ни лежали
    # Создаем словарь: { "sv_warrior.png": "assets/sv_warrior.png" }
    print(f"[*] Индексация файлов в {ASSETS_DIR}...")
    local_files_index = {}
    
    for root, _, files in os.walk(ASSETS_DIR):
        for file in files:
            if file.lower().endswith(".png"):
                # Ключ - имя файла в нижнем регистре
                key = file.lower()
                # Значение - путь, понятный браузеру (относительно корня frontend)
                rel_path = Path(root).relative_to(PROJECT_ROOT / "frontend") / file
                # Важно: используем as_posix() чтобы слеши были / (как в web), а не \ (как в Windows)
                local_files_index[key] = rel_path.as_posix()

    final_map = {}
    print(f"[*] Сопоставление ассетов...")

    for category in CATEGORIES_TO_MAP:
        if category not in game_dict: continue
        
        # Перебираем ID из игры: "UNIT_WARRIOR"
        for game_name in game_dict[category].values():
            found_path = None
            
            # --- СТРАТЕГИЯ 1: XML ArtDefines (Самая точная) ---
            possible_keys = [
                f"ART_DEF_{game_name}",       # Стандарт
                game_name,                    # Иногда совпадает
                game_name.replace("UNIT_", "ART_DEF_UNIT_"),
                game_name.replace("FEATURE_", "ART_DEF_FEATURE_"),
                game_name.replace("BUILDING_", "ART_DEF_BUILDING_"),
                game_name.replace("RESOURCE_", "ART_DEF_RESOURCE_")
            ]
            
            target_filename = None
            for key in possible_keys:
                if key in art_defines:
                    target_filename = art_defines[key] # Например "sv_warrior.png"
                    break
            
            # Если XML дал имя файла, ищем его у нас
            if target_filename and target_filename in local_files_index:
                found_path = local_files_index[target_filename]

            # --- СТРАТЕГИЯ 2: Fuzzy Match (Если XML не помог) ---
            # Полезна для террейнов, которых часто нет в StrategicView XML
            if not found_path:
                clean_game_name = game_name.lower().replace("unit_", "").replace("feature_", "").replace("terrain_", "").replace("_", "")
                
                # Ищем среди всех файлов
                for filename, path in local_files_index.items():
                    clean_file = filename.replace(".png", "").replace("sv_", "").replace("_", "")
                    
                    if clean_game_name == clean_file:
                        found_path = path
                        break
                        
            # --- РЕЗУЛЬТАТ ---
            if found_path:
                final_map[game_name] = found_path
            
    # Сохраняем
    js_content = f"window.ASSET_MAP = {json.dumps(final_map, indent=2)};"
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)
    
    print(f"\n[SUCCESS] Маппинг обновлен. Записей: {len(final_map)}")
    print(f"Файлов в assets: {len(local_files_index)}")

if __name__ == "__main__":
    generate_map()