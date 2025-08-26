-- 游戏脚本示例：单位创建和管理
function CreateGameUnits()
    -- 创建步兵单位
    local footman = CreateUnit("footman", 100, 200)
    SetUnitProperty(footman, "hp", 500)
    
    -- 创建弓箭手
    local archer = CreateUnit("archer", 150, 250)
    
    -- 批量创建单位
    for i = 1, 5 do
        CreateUnit("footman", 100 + i * 50, 300)
    end
end

-- 技能系统
function CastSpell(unitId, spellId)
    if spellId == "fireball" then
        print("施放火球术")
    elseif spellId == "heal" then
        print("施放治疗术")
    end
end

-- 物品系统
function CreateItems()
    local sword = CreateItem("sword", 200, 300)
    local shield = CreateItem("shield", 250, 350)
    
    -- 给单位装备物品
    GiveItemToUnit("footman", "sword")
end
