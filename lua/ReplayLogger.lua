-- ============================================================================
-- ReplayLogger.lua
-- ============================================================================

ReplayLogger = {}
ReplayLogger.VERSION = "2.0"
ReplayLogger.lastProcessedTurn = -1
ReplayLogger.isHeaderSent = false

-- ============================================================================
-- DKJSON LIBRARY (EMBEDDED)
-- ============================================================================
local json = (function() 
  -- Module options:
  local always_use_lpeg = false
  local register_global_module_table = false -- Исправлено: False -> false
  local global_module_name = 'json'

  --[==[
  David Kolf's JSON module for Lua 5.1 - 5.4
  Version 2.8
  ]==]

  -- global dependencies:
  local pairs, type, tostring, tonumber, getmetatable, setmetatable =
        pairs, type, tostring, tonumber, getmetatable, setmetatable
  local error, require, pcall, select = error, require, pcall, select
  local floor, huge = math.floor, math.huge
  local strrep, gsub, strsub, strbyte, strchar, strfind, strlen, strformat =
        string.rep, string.gsub, string.sub, string.byte, string.char,
        string.find, string.len, string.format
  local strmatch = string.match
  local concat = table.concat

  local json = { version = "dkjson 2.8" }

  local jsonlpeg = {}

  if register_global_module_table then
    if always_use_lpeg then
      _G[global_module_name] = jsonlpeg
    else
      _G[global_module_name] = json
    end
  end

  local _ENV = nil 

  pcall (function()
    local debmeta = require "debug".getmetatable
    if debmeta then getmetatable = debmeta end
  end)

  json.null = setmetatable ({}, {
    __tojson = function () return "null" end
  })

  local function isarray (tbl)
    local max, n, arraylen = 0, 0, 0
    for k,v in pairs (tbl) do
      if k == 'n' and type(v) == 'number' then
        arraylen = v
        if v > max then
          max = v
        end
      else
        if type(k) ~= 'number' or k < 1 or floor(k) ~= k then
          return false
        end
        if k > max then
          max = k
        end
        n = n + 1
      end
    end
    if max > 10 and max > arraylen and max > n * 2 then
      return false 
    end
    return true, max
  end

  local escapecodes = {
    ["\""] = "\\\"", ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
    ["\n"] = "\\n",  ["\r"] = "\\r",  ["\t"] = "\\t"
  }

  local function escapeutf8 (uchar)
    local value = escapecodes[uchar]
    if value then
      return value
    end
    local a, b, c, d = strbyte (uchar, 1, 4)
    a, b, c, d = a or 0, b or 0, c or 0, d or 0
    if a <= 0x7f then
      value = a
    elseif 0xc0 <= a and a <= 0xdf and b >= 0x80 then
      value = (a - 0xc0) * 0x40 + b - 0x80
    elseif 0xe0 <= a and a <= 0xef and b >= 0x80 and c >= 0x80 then
      value = ((a - 0xe0) * 0x40 + b - 0x80) * 0x40 + c - 0x80
    elseif 0xf0 <= a and a <= 0xf7 and b >= 0x80 and c >= 0x80 and d >= 0x80 then
      value = (((a - 0xf0) * 0x40 + b - 0x80) * 0x40 + c - 0x80) * 0x40 + d - 0x80
    else
      return ""
    end
    if value <= 0xffff then
      return strformat ("\\u%.4x", value)
    elseif value <= 0x10ffff then
      value = value - 0x10000
      local highsur, lowsur = 0xD800 + floor (value/0x400), 0xDC00 + (value % 0x400)
      return strformat ("\\u%.4x\\u%.4x", highsur, lowsur)
    else
      return ""
    end
  end

  local function fsub (str, pattern, repl)
    if strfind (str, pattern) then
      return gsub (str, pattern, repl)
    else
      return str
    end
  end

  local function quotestring (value)
    value = fsub (value, "[%z\1-\31\"\\\127]", escapeutf8)
    if strfind (value, "[\194\216\220\225\226\239]") then
      value = fsub (value, "\194[\128-\159\173]", escapeutf8)
      value = fsub (value, "\216[\128-\132]", escapeutf8)
      value = fsub (value, "\220\143", escapeutf8)
      value = fsub (value, "\225\158[\180\181]", escapeutf8)
      value = fsub (value, "\226\128[\140-\143\168-\175]", escapeutf8)
      value = fsub (value, "\226\129[\160-\175]", escapeutf8)
      value = fsub (value, "\239\187\191", escapeutf8)
      value = fsub (value, "\239\191[\176-\191]", escapeutf8)
    end
    return "\"" .. value .. "\""
  end
  json.quotestring = quotestring

  local function replace(str, o, n)
    local i, j = strfind (str, o, 1, true)
    if i then
      return strsub(str, 1, i-1) .. n .. strsub(str, j+1, -1)
    else
      return str
    end
  end

  local decpoint, numfilter

  local function updatedecpoint ()
    decpoint = strmatch(tostring(0.5), "([^05+])")
    numfilter = "[^0-9%-%+eE" .. gsub(decpoint, "[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0") .. "]+"
  end

  updatedecpoint()

  local function num2str (num)
    return replace(fsub(tostring(num), numfilter, ""), decpoint, ".")
  end

  local function str2num (str)
    local num = tonumber(replace(str, ".", decpoint))
    if not num then
      updatedecpoint()
      num = tonumber(replace(str, ".", decpoint))
    end
    return num
  end

  local function addnewline2 (level, buffer, buflen)
    buffer[buflen+1] = "\n"
    buffer[buflen+2] = strrep ("  ", level)
    buflen = buflen + 2
    return buflen
  end

  function json.addnewline (state)
    if state.indent then
      state.bufferlen = addnewline2 (state.level or 0,
                             state.buffer, state.bufferlen or #(state.buffer))
    end
  end

  local encode2 

  local function addpair (key, value, prev, indent, level, buffer, buflen, tables, globalorder, state)
    local kt = type (key)
    if kt ~= 'string' and kt ~= 'number' then
      return nil, "type '" .. kt .. "' is not supported as a key by JSON."
    end
    if prev then
      buflen = buflen + 1
      buffer[buflen] = ","
    end
    if indent then
      buflen = addnewline2 (level, buffer, buflen)
    end
    buffer[buflen+1] = quotestring (key)
    buffer[buflen+2] = ":"
    return encode2 (value, indent, level, buffer, buflen + 2, tables, globalorder, state)
  end

  local function appendcustom(res, buffer, state)
    local buflen = state.bufferlen
    if type (res) == 'string' then
      buflen = buflen + 1
      buffer[buflen] = res
    end
    return buflen
  end

  local function exception(reason, value, state, buffer, buflen, defaultmessage)
    defaultmessage = defaultmessage or reason
    local handler = state.exception
    if not handler then
      return nil, defaultmessage
    else
      state.bufferlen = buflen
      local ret, msg = handler (reason, value, state, defaultmessage)
      if not ret then return nil, msg or defaultmessage end
      return appendcustom(ret, buffer, state)
    end
  end

  function json.encodeexception(reason, value, state, defaultmessage)
    return quotestring("<" .. defaultmessage .. ">")
  end

  encode2 = function (value, indent, level, buffer, buflen, tables, globalorder, state)
    local valtype = type (value)
    local valmeta = getmetatable (value)
    valmeta = type (valmeta) == 'table' and valmeta 
    local valtojson = valmeta and valmeta.__tojson
    if valtojson then
      if tables[value] then
        return exception('reference cycle', value, state, buffer, buflen)
      end
      tables[value] = true
      state.bufferlen = buflen
      local ret, msg = valtojson (value, state)
      if not ret then return exception('custom encoder failed', value, state, buffer, buflen, msg) end
      tables[value] = nil
      buflen = appendcustom(ret, buffer, state)
    elseif value == nil then
      buflen = buflen + 1
      buffer[buflen] = "null"
    elseif valtype == 'number' then
      local s
      if value ~= value or value >= huge or -value >= huge then
        s = "null"
      else
        s = num2str (value)
      end
      buflen = buflen + 1
      buffer[buflen] = s
    elseif valtype == 'boolean' then
      buflen = buflen + 1
      buffer[buflen] = value and "true" or "false"
    elseif valtype == 'string' then
      buflen = buflen + 1
      buffer[buflen] = quotestring (value)
    elseif valtype == 'table' then
      if tables[value] then
        return exception('reference cycle', value, state, buffer, buflen)
      end
      tables[value] = true
      level = level + 1
      local isa, n = isarray (value)
      if n == 0 and valmeta and valmeta.__jsontype == 'object' then
        isa = false
      end
      local msg
      if isa then 
        buflen = buflen + 1
        buffer[buflen] = "["
        for i = 1, n do
          buflen, msg = encode2 (value[i], indent, level, buffer, buflen, tables, globalorder, state)
          if not buflen then return nil, msg end
          if i < n then
            buflen = buflen + 1
            buffer[buflen] = ","
          end
        end
        buflen = buflen + 1
        buffer[buflen] = "]"
      else 
        local prev = false
        buflen = buflen + 1
        buffer[buflen] = "{"
        local order = valmeta and valmeta.__jsonorder or globalorder
        if order then
          local used = {}
          n = #order
          for i = 1, n do
            local k = order[i]
            local v = value[k]
            if v ~= nil then
              used[k] = true
              buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
              if not buflen then return nil, msg end
              prev = true 
            end
          end
          for k,v in pairs (value) do
            if not used[k] then
              buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
              if not buflen then return nil, msg end
              prev = true 
            end
          end
        else 
          for k,v in pairs (value) do
            buflen, msg = addpair (k, v, prev, indent, level, buffer, buflen, tables, globalorder, state)
            if not buflen then return nil, msg end
            prev = true 
          end
        end
        if indent then
          buflen = addnewline2 (level - 1, buffer, buflen)
        end
        buflen = buflen + 1
        buffer[buflen] = "}"
      end
      tables[value] = nil
    else
      return exception ('unsupported type', value, state, buffer, buflen,
        "type '" .. valtype .. "' is not supported by JSON.")
    end
    return buflen
  end

  function json.encode (value, state)
    state = state or {}
    local oldbuffer = state.buffer
    local buffer = oldbuffer or {}
    state.buffer = buffer
    updatedecpoint()
    local ret, msg = encode2 (value, state.indent, state.level or 0,
                     buffer, state.bufferlen or 0, state.tables or {}, state.keyorder, state)
    if not ret then
      error (msg, 2)
    elseif oldbuffer == buffer then
      state.bufferlen = ret
      return true
    else
      state.bufferlen = nil
      state.buffer = nil
      return concat (buffer)
    end
  end

  -- Return the module table
  return json
end)()
-- ============================================================================
-- END DKJSON LIBRARY
-- ============================================================================

-- Глобальный кэш состояния тайлов, чтобы слать только изменения
ReplayLogger.MapCache = {} 

function ReplayLogger.InitMapCache()
    local numPlots = Map.GetNumPlots()
    for i = 0, numPlots - 1 do
        local plot = Map.GetPlotByIndex(i)
        ReplayLogger.MapCache[i] = {
            f = plot:GetFeatureType(),
            i = plot:GetImprovementType(),
            r = plot:GetResourceType(),
            -- Route (Дорога) тоже полезна
            rt = plot:GetRouteType(),
            p = plot:IsImprovementPillaged() -- Разграблено ли?
        }
    end
end

-- === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

function ReplayLogger.PrintBigData(prefix, data)
    local chunkSize = 3900 -- Чуть меньше 4кб для безопасности
    local length = string.len(data)
    local numChunks = math.ceil(length / chunkSize)
    -- Используем os.clock() для миллисекунд, чтобы избежать коллизий ID
    local uuid = os.time() .. "-" .. math.floor(os.clock()*1000) .. "-" .. Game.GetGameTurn()

    print(prefix .. "START:" .. uuid .. ":" .. numChunks)
    for i = 1, numChunks do
        local startIdx = (i - 1) * chunkSize + 1
        local endIdx = math.min(i * chunkSize, length)
        print(prefix .. "CHUNK:" .. uuid .. ":" .. i .. ":" .. string.sub(data, startIdx, endIdx))
    end
    print(prefix .. "END:" .. uuid)
end

-- === СБОР СЛОВАРЕЙ И МЕТА-ДАННЫХ ===

function ReplayLogger.GetGameSignature()
  local w, h = Map.GetGridSize()
  local speed = GameInfo.GameSpeeds[PreGame.GetGameSpeed()].Type
  -- Убрали Game.GetGameRandomSeed()
  
  local sig = "Map-" .. w .. "x" .. h .. "-Speed-" .. speed .. "-Sample-"
  
  -- Используем "Отпечаток карты" для уникальности
  -- Берем каждый ~50-й тайл и записываем его тип.
  -- Это гарантирует, что другая карта того же размера будет иметь другой хеш.
  local totalPlots = Map.GetNumPlots()
  local step = math.floor(totalPlots / 50)
  if step < 1 then step = 1 end
  
  for i = 0, totalPlots - 1, step do
      local plot = Map.GetPlotByIndex(i)
      if plot then
          -- Пишем тип местности и фичи (лес/джунгли)
          sig = sig .. plot:GetTerrainType() .. plot:GetFeatureType()
      end
  end
  
  return sig
end

function ReplayLogger.GetGameDictionaries()
  local dict = {
      civilizations = {}, units = {}, buildings = {}, 
      technologies = {}, policies = {}, policyBranches = {},
      terrains = {}, features = {}, improvements = {}, resources = {},
      beliefs = {}
  }
  
  -- 1. ОПРЕДЕЛЕНИЕ ФУНКЦИИ (Должно быть в самом начале!)
  -- Универсальный заполнитель: ID -> { type, name }
  local function FillDictFull(dest, tableName)
      for row in GameInfo[tableName]() do 
          dest[tostring(row.ID)] = {
              type = row.Type,
              name = Locale.ConvertTextKey(row.Description)
          }
      end
  end

  -- 2. ВЫЗОВЫ (Строго после определения)
  FillDictFull(dict.civilizations, "Civilizations")
  FillDictFull(dict.units, "Units")
  FillDictFull(dict.buildings, "Buildings")
  FillDictFull(dict.terrains, "Terrains")
  FillDictFull(dict.features, "Features")
  FillDictFull(dict.improvements, "Improvements")
  FillDictFull(dict.resources, "Resources")
  
  -- Политики
  dict.policies = {}
  for row in GameInfo.Policies() do
      dict.policies[tostring(row.ID)] = {
          type = row.Type,
          name = Locale.ConvertTextKey(row.Description),
          branch = row.PolicyBranchType
      }
  end

  -- Ветки политик
  for row in GameInfo.PolicyBranchTypes() do
      dict.policyBranches[row.Type] = Locale.ConvertTextKey(row.Description)
  end

  -- Верования
  for row in GameInfo.Beliefs() do
      dict.beliefs[tostring(row.ID)] = {
          type = row.Type, 
          name = Locale.ConvertTextKey(row.ShortDescription),
          desc = Locale.ConvertTextKey(row.Description)
      }
  end

  -- Технологии
  dict.technologies = {}
  for row in GameInfo.Technologies() do
      local prereqs = {}
      for pr in GameInfo.Technology_PrereqTechs{TechType = row.Type} do
          local pRow = GameInfo.Technologies[pr.PrereqTech]
          if pRow then table.insert(prereqs, pRow.ID) end
      end
      dict.technologies[tostring(row.ID)] = {
          type = row.Type,
          name = Locale.ConvertTextKey(row.Description), 
          gridX = row.GridX, gridY = row.GridY,
          cost = row.Cost, prereqs = prereqs
      }
  end

  return dict
end

function ReplayLogger.GetStaticMap()
    local w, h = Map.GetGridSize()
    local tiles = {}
    local numPlots = Map.GetNumPlots()

    for i = 0, numPlots - 1 do
        local plot = Map.GetPlotByIndex(i)
        -- Добавляем isHill/isMountain явно через PlotType
        -- 0=Mountain, 1=Hills, 2=Flat, 3=Ocean
        tiles[i + 1] = {
            t = plot:GetTerrainType(),
            f = plot:GetFeatureType(),
            r = plot:GetResourceType(),
            p = plot:GetPlotType() 
        }
    end
    return { width = w, height = h, tiles = tiles }
end

function ReplayLogger.SendGameHeader()
    print("ReplayLogger: Формирование HEADER...")
    
    local header = {
        type = "HEADER",
        version = ReplayLogger.VERSION,
        signature = ReplayLogger.GetGameSignature(),
        timestamp = os.time(),
        gameInfo = {
            speed = GameInfo.GameSpeeds[PreGame.GetGameSpeed()].Type,
            mapScript = PreGame.GetMapScript(),
            difficulty = GameInfo.HandicapInfos[Game.GetHandicapType()].Type,
            startTurn = Game.GetStartTurn()
        },
        dictionary = ReplayLogger.GetGameDictionaries(),
        staticMap = ReplayLogger.GetStaticMap()
    }
    ReplayLogger.InitMapCache()
    local jsonString = json.encode(header)
    ReplayLogger.PrintBigData("CIV5_DATA_JSON::", jsonString)
    ReplayLogger.isHeaderSent = true
    
    -- Очистка памяти после тяжелого хедера
    collectgarbage("collect")
end

-- === СБОР ДАННЫХ ЗА ХОД (SNAPSHOT) ===

function ReplayLogger.GetTurnSnapshot(iTurn)
  local snapshot = {
      type = "TURN",
      turn = iTurn,
      timestamp = os.time(),
      players = {},
      cities = {},
      units = {},
      territory = {},
      mapChanges = {}
  }

    -- 1. СКАНИРОВАНИЕ КАРТЫ (оставил без изменений, код был верный)
    local numPlots = Map.GetNumPlots()
    for i = 0, numPlots - 1 do
        local plot = Map.GetPlotByIndex(i)
        snapshot.territory[i + 1] = plot:GetOwner()
        
        local cache = ReplayLogger.MapCache[i]
        local currentF = plot:GetFeatureType()
        local currentI = plot:GetImprovementType()
        local currentR = plot:GetResourceType()
        local currentRt = plot:GetRouteType()
        local currentP = plot:IsImprovementPillaged()
        
        if not cache or cache.f ~= currentF or cache.i ~= currentI or 
           cache.r ~= currentR or cache.rt ~= currentRt or cache.p ~= currentP then
           
            table.insert(snapshot.mapChanges, {
                id = i, f = currentF, i = currentI, r = currentR, rt = currentRt, p = currentP
            })
            ReplayLogger.MapCache[i] = {
                f = currentF, i = currentI, r = currentR, rt = currentRt, p = currentP
            }
        end
    end

    -- 2. СКАНИРОВАНИЕ ИГРОКОВ (Исправлено для Варваров)
    -- В Civ 5 ID игроков идут от 0 до 63 (MAX_CIV_PLAYERS обычно 64)
    -- ID 63 - Всегда Варвары
    for i = 0, GameDefines.MAX_CIV_PLAYERS do 
      local p = Players[i]
      
      -- Проверка: Игрок существует И (Жив когда-либо ИЛИ это Варвары)
      -- Варвары всегда "Alive", но IsEverAlive иногда шалит до спавна первого лагеря
      if p and (p:IsEverAlive() or i == 63) then
          
          -- Доп. проверка: если это не варвары и не ГГ, и статус "мертв" - пропускаем,
          -- если не хотим показывать трупы в списке (хотя для истории может быть полезно оставить)
          if p:IsAlive() or i == 63 then 
              
              local isMinor = p:IsMinorCiv()
              local isBarbarian = (i == 63) -- Надежнее проверять по ID
              
              local pData = {
                  id = i,
                  name = isBarbarian and "Barbarians" or p:GetName(),
                  civName = isBarbarian and "Barbarians" or p:GetCivilizationDescription(),
                  isAlive = p:IsAlive(),
                  isMinor = isMinor,
                  isBarbarian = isBarbarian,
                  gold = p:GetGold(),
                  score = p:GetScore(),
                  -- Инициализируем пустыми, чтобы JSON был компактнее
                  tech = nil,
                  policies = nil
              }
              
              -- Статистику собираем ТОЛЬКО для Мажоров (не ГГ, не Варвары)
              if not isMinor and not isBarbarian then
                  pData.goldPerTurn = p:CalculateGoldRate()
                  pData.science = p:GetScience()
                  pData.culture = (p.GetTotalJONSCulturePerTurn and p:GetTotalJONSCulturePerTurn()) or 0
                  pData.totalCulture = p:GetJONSCulture()
                  pData.happiness = p:GetExcessHappiness()
                  pData.faith = p:GetFaith()
                  pData.tourism = (p.GetTourism and p:GetTourism()) or 0
                  
                  -- Военная мощь (варвары её имеют, но считаем только для игроков пока)
                  pData.military = p:GetMilitaryMight()

                  -- ТЕХНОЛОГИИ
                  local pTeam = Teams[p:GetTeam()]
                  pData.tech = { current = -1, progress = 0, researched = {} }
                  
                  local currentTech = p:GetCurrentResearch()
                  if currentTech ~= -1 then
                      pData.tech.current = currentTech
                      pData.tech.progress = p:GetResearchProgress(currentTech)
                  end
                  
                  -- Оптимизация: слать только ID изученных
                  -- (В идеале слать только дельту, но пока шлем полный список)
                  local researched = {}
                  for tech in GameInfo.Technologies() do
                      if pTeam:IsHasTech(tech.ID) then
                          table.insert(researched, tech.ID)
                      end
                  end
                  pData.tech.researched = researched

                  -- ПОЛИТИКИ
                  local policies = {}
                  for policy in GameInfo.Policies() do
                      if p:HasPolicy(policy.ID) then
                          table.insert(policies, policy.ID)
                      end
                  end
                  pData.policies = policies
                  
                  -- РЕЛИГИЯ И ПАНТЕОНЫ
                  local eReligion = p:GetReligionCreatedByPlayer()
                  
                  -- 1. Если есть Полноценная Религия
                  if eReligion > 0 and eReligion ~= -1 then
                      local beliefs = {}
                      for _, beliefID in ipairs(Game.GetBeliefsInReligion(eReligion)) do
                          table.insert(beliefs, beliefID)
                      end
                      
                      pData.religion = {
                          type = "RELIGION",
                          name = Game.GetReligionName(eReligion),
                          beliefs = beliefs
                      }
                      
                  -- 2. Если Религии нет, но есть Пантеон
                  elseif p:HasCreatedPantheon() then
                      local pantheonBelief = p:GetBeliefInPantheon()
                      if pantheonBelief > -1 then
                          pData.religion = {
                              type = "PANTHEON",
                              name = "Pantheon", -- Локализация на фронте или тут (TXT_KEY_RELIGION_PANTHEON)
                              beliefs = { pantheonBelief }
                          }
                      end
                  end
              end

              -- Для варваров можно добавить специфичные поля, если нужно, 
              -- но пока оставляем базовый name/id/gold
              
              table.insert(snapshot.players, pData)
              
              -- ЮНИТЫ (Варвары имеют юнитов!)
              for unit in p:Units() do
                  table.insert(snapshot.units, {
                      id = unit:GetID(),
                      owner = i,
                      type = unit:GetUnitType(),
                      x = unit:GetX(), y = unit:GetY(),
                      hp = unit:GetCurrHitPoints(),
                      moves = unit:GetMoves()
                      -- promotion? level?
                  })
              end

              -- ГОРОДА (Варвары могут захватывать города, хотя редко)
              for city in p:Cities() do
                  -- Код сбора городов такой же
                  local yields = {
                      food = city:GetYieldRate(YieldTypes.YIELD_FOOD),
                      prod = city:GetYieldRate(YieldTypes.YIELD_PRODUCTION),
                      gold = city:GetYieldRate(YieldTypes.YIELD_GOLD),
                      sci = city:GetYieldRate(YieldTypes.YIELD_SCIENCE),
                      cult = (city.GetJONSCulturePerTurn and city:GetJONSCulturePerTurn()) or 0,
                      faith = (city.GetFaithPerTurn and city:GetFaithPerTurn()) or 0
                  }

                  -- === СБОР ОБРАБОТКИ И БЛОКИРОВОК ===
                  local worked = {}
                  local locked = {} -- Новый массив для ID заблокированных тайлов

                  for j = 0, city:GetNumCityPlots() - 1 do
                      local plot = city:GetCityIndexPlot(j)
                      if plot then
                          local plotIdx = plot:GetPlotIndex()
                          
                          -- 1. Если тайл обрабатывается
                          if city:IsWorkingPlot(plot) then
                              table.insert(worked, plotIdx)
                              
                              -- 2. Если тайл ПРИНУДИТЕЛЬНО обрабатывается (Locked)
                              if city:IsForcedWorkingPlot(plot) then
                                  table.insert(locked, plotIdx)
                              end
                          end
                      end
                  end

                  -- 1. СБОР ЗДАНИЙ И СПЕЦИАЛИСТОВ В НИХ
                  local buildings = {} -- Просто список ID зданий (для иконок)
                  local specSlots = {} -- Детализация: {buildingID, count}
                  
                  for b in GameInfo.Buildings() do
                      if city:IsHasBuilding(b.ID) then
                          table.insert(buildings, b.ID)
                          
                          -- Проверяем, есть ли слоты и заняты ли они
                          if city:GetNumSpecialistsAllowedByBuilding(b.ID) > 0 then
                              local numInBuilding = city:GetNumSpecialistsInBuilding(b.ID)
                              if numInBuilding > 0 then
                                  table.insert(specSlots, {
                                      b = b.ID,       -- ID здания
                                      c = numInBuilding -- Сколько там сидит
                                  })
                              end
                          end
                      end
                  end

                  -- 2. БЕЗДЕЛЬНИКИ (Slackers)
                  -- Обычно это Default Specialist (Citizen)
                  local defaultSpecID = GameDefines.DEFAULT_SPECIALIST
                  local slackers = city:GetSpecialistCount(defaultSpecID)

                  -- 3. ПРОГРЕСС ВЕЛИКИХ ЛЮДЕЙ
                  local gpProgress = {}
                  for spec in GameInfo.Specialists() do
                      -- Нас интересуют только те, кто рождает GP (Great People)
                      if spec.GreatPeopleUnitClass and spec.GreatPeopleUnitClass ~= "NULL" then
                          local progress = city:GetSpecialistGreatPersonProgress(spec.ID)
                          if progress > 0 then
                              -- Находим порог (сколько надо накопить)
                              local unitClass = GameInfo.UnitClasses[spec.GreatPeopleUnitClass]
                              local threshold = 0
                              if unitClass then
                                  threshold = city:GetSpecialistUpgradeThreshold(unitClass.ID)
                              end
                              
                              table.insert(gpProgress, {
                                  s = spec.ID,      -- ID специалиста (Writer, Scientist...)
                                  p = progress,     -- Текущий прогресс
                                  t = threshold     -- Цель
                              })
                          end
                      end
                  end

                  -- 4. ОБРАБОТКА ТАЙЛОВ (Твой код)
                  local worked = {}
                  local locked = {}
                  for j = 0, city:GetNumCityPlots() - 1 do
                      local plot = city:GetCityIndexPlot(j)
                      if plot and city:IsWorkingPlot(plot) then
                          local pIdx = plot:GetPlotIndex()
                          table.insert(worked, pIdx)
                          if city:IsForcedWorkingPlot(plot) then
                              table.insert(locked, pIdx)
                          end
                      end
                  end

                  -- ЗАПИСЬ В ТАБЛИЦУ
                  table.insert(snapshot.cities, {
                      id = city:GetID(),
                      owner = i,
                      name = city:GetName(),
                      x = city:GetX(), y = city:GetY(),
                      pop = city:GetPopulation(),
                      hp = city:GetMaxHitPoints() - city:GetDamage(),
                      
                      focus = city:GetFocusType(), -- ФОКУС
                      
                      buildings = buildings,
                      specSlots = specSlots, -- <--- Новое: занятые слоты в зданиях
                      slackers = slackers,   -- <--- Новое: безработные
                      gpProgress = gpProgress, -- <--- Новое: прогресс GP
                      
                      yields = yields,
                      prodItem = Locale.ConvertTextKey(city:GetProductionNameKey()), 
                      prodTurns = city:GetProductionTurnsLeft(),
                      worked = worked,
                      locked = locked
                  })
              end
          end
      end
    end

  return snapshot
end

-- === EVENT HANDLERS ===

function ReplayLogger.OnTurnStart()
    -- Инициализация при первом вызове
    if not ReplayLogger.isHeaderSent then ReplayLogger.SendGameHeader() end

    local iTurn = Game.GetGameTurn()
    if iTurn == ReplayLogger.lastProcessedTurn then return end
    ReplayLogger.lastProcessedTurn = iTurn

    print("ReplayLogger: Сбор данных за ход " .. iTurn)
    local turnData = ReplayLogger.GetTurnSnapshot(iTurn)
    
    ReplayLogger.PrintBigData("CIV5_DATA_JSON::", json.encode(turnData))
    
    -- Управление памятью (InfoAddict делает это раз в 10 ходов, мы делаем каждый, т.к. json тяжелый)
    collectgarbage("collect")
end

function ReplayLogger.OnVictory(iWinner, iVictoryType)
    print("ReplayLogger: VICTORY DETECTED!")
    local victoryData = {
        type = "WINNER",
        turn = Game.GetGameTurn(),
        winner = iWinner,
        victoryType = GameInfo.Victories[iVictoryType].Type
    }
    ReplayLogger.PrintBigData("CIV5_DATA_JSON::", json.encode(victoryData))
end

function ReplayLogger.OnUIShow()
    if not ReplayLogger.isHeaderSent then ReplayLogger.SendGameHeader() end
end

-- === REGISTRATION ===

Events.ActivePlayerTurnStart.Add(ReplayLogger.OnTurnStart)
-- Events.GameVictory.Add(ReplayLogger.OnVictory)
-- Инициализация при загрузке (если мод загружен после старта)
Events.SequenceGameInitComplete.Add(ReplayLogger.OnUIShow)

print("ReplayLogger: Script Loaded Successfully.")