-- 只增不减装饰器测试文件
-- 这个文件用来测试新的装饰器行为：
-- 1. 光标移动时装饰只增加，不删除
-- 2. 不同文件有独立的装饰缓存
-- 3. 无需清理，性能更优

-- ===== 第1-100行：初始测试区域 =====
function InitialTestArea()
    print("=== 初始测试区域 ===")
    
    -- 将光标放在这里，这些配置项会被装饰
    CreateUnit("footman", 100, 200)
    CreateUnit("archer", 150, 250)
    GiveItemToUnit("footman", "sword")
    CastSpell("archer", "fireball")
    
    print("第一批装饰应该出现")
    
    for i = 1, 50 do
        print("填充行" .. i)
        if i % 10 == 0 then
            CreateUnit("footman", i * 10, i * 20)
        end
    end
    
    print("=== 初始区域结束 ===")
end

-- ===== 第101-300行：扩展区域1 =====
function ExtendedArea1()
    print("### 扩展区域1开始 ###")
    
    -- 当光标移动到这里时：
    -- 1. 上面的装饰依然保留（不删除）
    -- 2. 这里会新增装饰
    for i = 1, 100 do
        print("扩展区域1 - 行" .. i)
        
        if i % 8 == 0 then
            CreateUnit("footman", i + 500, i + 600)  -- 新增装饰
            CreateUnit("archer", i + 700, i + 800)   -- 新增装饰
        end
        
        if i % 15 == 0 then
            CreateItem("sword", i, i)
            CreateItem("shield", i + 100, i + 200)
        end
    end
    
    -- 密集配置项测试
    CreateUnit("footman", 1001, 1002)
    CreateUnit("footman", 1003, 1004)
    CreateUnit("footman", 1005, 1006)
    CreateUnit("archer", 2001, 2002)
    CreateUnit("archer", 2003, 2004)
    CreateUnit("archer", 2005, 2006)
    
    print("### 扩展区域1结束 ###")
end

-- ===== 第301-600行：扩展区域2 =====
function ExtendedArea2()
    print("@@@ 扩展区域2开始 @@@")
    
    -- 继续移动光标到这里：
    -- 1. 前面所有的装饰都保留
    -- 2. 这里继续新增装饰
    -- 3. 装饰数量只增不减
    
    for i = 1, 200 do
        print("扩展区域2 - 行" .. i)
        
        if i % 12 == 0 then
            CreateUnit("footman", i + 3000, i + 4000)  -- 继续新增
            GiveItemToUnit("footman", "sword")
        end
        
        if i % 18 == 0 then
            CreateUnit("archer", i + 5000, i + 6000)   -- 继续新增
            CastSpell("archer", "heal")
        end
    end
    
    -- 更多配置项引用
    print("密集引用区域")
    for j = 1, 20 do
        CreateUnit("footman", j * 100, j * 200)  -- 大量新增装饰
    end
    
    print("@@@ 扩展区域2结束 @@@")
end

-- ===== 第601-900行：扩展区域3 =====
function ExtendedArea3()
    print("%%% 扩展区域3开始 %%%")
    
    -- 最后的测试区域：
    -- 1. 前面所有区域的装饰都保留
    -- 2. 这里是最后的新增装饰
    -- 3. 文件内装饰总数达到最大值
    
    for i = 1, 250 do
        print("扩展区域3 - 行" .. i)
        
        if i % 6 == 0 then
            CreateUnit("footman", i + 8000, i + 9000)  -- 最后的新增
        end
        
        if i % 9 == 0 then
            CreateUnit("archer", i + 10000, i + 11000) -- 最后的新增
        end
        
        if i % 20 == 0 then
            print("装饰统计检查点" .. i)
            CreateUnit("footman", 99999, 99999)
            CreateUnit("archer", 88888, 88888)
        end
    end
    
    print("%%% 扩展区域3结束 %%%")
    print("文件结束 - 所有装饰都应该保留")
end

-- 测试说明：
-- 
-- 1. 将光标放在第50行附近
--    → 应该看到初始区域的装饰出现
-- 
-- 2. 移动光标到第200行
--    → 初始区域装饰保留 + 扩展区域1的装饰新增
-- 
-- 3. 移动光标到第450行  
--    → 前面所有装饰保留 + 扩展区域2的装饰新增
-- 
-- 4. 移动光标到第750行
--    → 前面所有装饰保留 + 扩展区域3的装饰新增
-- 
-- 5. 最终结果：整个文件的所有配置项都被装饰
-- 
-- 控制台输出应该显示：
-- "新增装饰 X 个，总装饰数量: Y" （Y 只增不减）
-- 
-- 不同文件切换时，每个文件有独立的装饰缓存
