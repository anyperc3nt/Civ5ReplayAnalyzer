-- ============================================================================
-- ReplayLogger.lua v2.0 (Enhanced Edition)
-- Based on InfoAddict logic & Custom Replay Architecture
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
        technologies = {}, policies = {},
        terrains = {}, features = {}, improvements = {}, resources = {}
    }
    
    local function FillDict(dest, tableName)
        for row in GameInfo[tableName]() do dest[tostring(row.ID)] = row.Type end
    end

    FillDict(dict.civilizations, "Civilizations")
    FillDict(dict.units, "Units")
    FillDict(dict.buildings, "Buildings")
    FillDict(dict.technologies, "Technologies")
    FillDict(dict.policies, "Policies")
    FillDict(dict.terrains, "Terrains")
    FillDict(dict.features, "Features")
    FillDict(dict.improvements, "Improvements")
    FillDict(dict.resources, "Resources")
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
      -- Новые слои карты
      territory = {}, -- Массив ID владельцев клеток
      mapObjects = {} -- Руины и лагеря варваров
  }

  -- 1. СКАНИРОВАНИЕ КАРТЫ (Владения, Руины, Лагеря)
  -- Проходим по всем тайлам. Это быстро.
  local numPlots = Map.GetNumPlots()
  
  -- ID улучшений для поиска (кэшируем для скорости)
  local impRuins = GameInfo.Improvements["IMPROVEMENT_GOODY_HUT"].ID
  local impBarbCamp = GameInfo.Improvements["IMPROVEMENT_BARBARIAN_CAMP"].ID
  
  for i = 0, numPlots - 1 do
      local plot = Map.GetPlotByIndex(i)
      
      -- А. Владелец тайла (для границ)
      -- -1 если ничей, иначе ID игрока
      snapshot.territory[i + 1] = plot:GetOwner()
      
      -- Б. Объекты (Руины, Лагеря)
      local imp = plot:GetImprovementType()
      if imp == impRuins then
          table.insert(snapshot.mapObjects, { type = "RUIN", x = plot:GetX(), y = plot:GetY() })
      elseif imp == impBarbCamp then
          table.insert(snapshot.mapObjects, { type = "CAMP", x = plot:GetX(), y = plot:GetY() })
      end
  end

  -- 2. СКАНИРОВАНИЕ ИГРОКОВ (Включая ГГ и Варваров)
  -- MAX_CIV_PLAYERS включает мажоров, ГГ и варваров
  for i = 0, GameDefines.MAX_CIV_PLAYERS - 1 do
      local p = Players[i]
      
      -- Проверка: Игрок существует, когда-либо жил.
      -- Для Варваров (обычно ID 63) IsEverAlive может быть false до спавна, поэтому проверяем ID
      if p and (p:IsEverAlive() or i == GameDefines.MAX_CIV_PLAYERS - 1) then
          local pTeam = Teams[p:GetTeam()]
          local isMinor = p:IsMinorCiv()
          local isBarbarian = p:IsBarbarian()
          
          -- Безопасные вызовы
          local cultPerTurn = (p.GetTotalJONSCulturePerTurn and p:GetTotalJONSCulturePerTurn()) or 0
          local tourismVal = (p.GetTourism and p:GetTourism()) or 0

          -- Базовая статистика
          local pData = {
              id = i,
              isAlive = p:IsAlive(),
              isMinor = isMinor,      -- Флаг для фронтенда: это ГГ
              isBarbarian = isBarbarian, -- Флаг для фронтенда: это варвары
              
              gold = p:GetGold(),
              score = p:GetScore(),
              
              -- Технологии и Политики собираем ТОЛЬКО для мажоров (ГГ не учат науку так же)
              tech = nil,
              policies = nil
          }
          
          -- Расширенная статистика только для Полноценных Цивилизаций (не Варвары, не ГГ)
          -- Хотя ГГ имеют золото и юнитов, им не нужна наука в реплее
          if not isMinor and not isBarbarian then
              pData.goldPerTurn = p:CalculateGoldRate()
              pData.science = p:GetScience()
              pData.culture = cultPerTurn
              pData.totalCulture = p:GetJONSCulture()
              pData.happiness = p:GetExcessHappiness()
              pData.military = p:GetMilitaryMight()
              pData.numCities = p:GetNumCities()
              pData.faith = p:GetFaith()
              pData.tourism = tourismVal
              
              -- ТЕХНОЛОГИИ (Дерево)
              pData.tech = { current = -1, progress = 0, needed = 0, researched = {} }
              
              local currentTech = p:GetCurrentResearch()
              if currentTech ~= -1 then
                  pData.tech.current = currentTech
                  pData.tech.progress = p:GetResearchProgress(currentTech)
                  pData.tech.needed = p:GetResearchCost(currentTech)
              end
              
              for tech in GameInfo.Technologies() do
                  if pTeam:IsHasTech(tech.ID) then
                      table.insert(pData.tech.researched, tech.ID)
                  end
              end

              -- ПОЛИТИКИ
              pData.policies = {}
              for policy in GameInfo.Policies() do
                  if p:HasPolicy(policy.ID) then
                      table.insert(pData.policies, policy.ID)
                  end
              end
          end

          table.insert(snapshot.players, pData)
          
          -- ЮНИТЫ И ГОРОДА (Если жив)
          if p:IsAlive() then
              -- Юниты
              for unit in p:Units() do
                  table.insert(snapshot.units, {
                      id = unit:GetID(),
                      owner = i,
                      type = unit:GetUnitType(),
                      x = unit:GetX(), y = unit:GetY(),
                      hp = unit:GetCurrHitPoints(),
                      moves = unit:GetMoves()
                  })
              end

              -- Города
              for city in p:Cities() do
                  local buildings = {}
                  for b in GameInfo.Buildings() do
                      if city:IsHasBuilding(b.ID) then
                          table.insert(buildings, b.ID)
                      end
                  end
                  
                  -- ДЕТАЛЬНЫЕ ДОХОДЫ ГОРОДА (YIELDS)
                  local yields = {
                      food = city:GetYieldRate(YieldTypes.YIELD_FOOD),
                      prod = city:GetYieldRate(YieldTypes.YIELD_PRODUCTION),
                      gold = city:GetYieldRate(YieldTypes.YIELD_GOLD),
                      sci = city:GetYieldRate(YieldTypes.YIELD_SCIENCE),
                      cult = (city.GetJONSCulturePerTurn and city:GetJONSCulturePerTurn()) or 0,
                      faith = (city.GetFaithPerTurn and city:GetFaithPerTurn()) or 0
                  }

                  table.insert(snapshot.cities, {
                      id = city:GetID(),
                      owner = i,
                      name = city:GetName(),
                      x = city:GetX(), y = city:GetY(),
                      pop = city:GetPopulation(),
                      hp = city:GetMaxHitPoints() - city:GetDamage(),
                      buildings = buildings,
                      yields = yields, -- <--- Новое поле
                      prodItem = city:GetProductionNameKey(), 
                      prodTurns = city:GetProductionTurnsLeft()
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