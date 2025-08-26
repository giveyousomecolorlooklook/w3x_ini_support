-- 增量渲染测试文件
-- 这个文件用来测试装饰器的增量渲染功能
-- 总共约1000行，测试在不同位置移动光标时的性能

-- ===== 区域1: 第1-250行 =====
-- 当光标在第1行时，这个区域应该被装饰
function TestRegion1()
    print("这是区域1的开始")
    
    -- 大量footman引用用于测试
    for i = 1, 100 do
        print("区域1 - 行" .. i)
        if i % 10 == 0 then
            CreateUnit("footman", i, 100)  -- 这些应该在光标附近时被高亮
            CreateUnit("archer", i, 200)
        end
    end
    
    -- 填充更多内容
    for i = 101, 200 do
        print("区域1填充 - 行" .. i)
        if i % 15 == 0 then
            GiveItemToUnit("footman", "sword")
            CastSpell("archer", "fireball")
        end
    end
    
    print("区域1结束")
end

-- ===== 区域2: 第251-500行 =====  
-- 当光标从区域1移动到这里时，应该看到增量更新
function TestRegion2()
    print("=== 这是区域2的开始 ===")
    
    -- 当光标移动到这里时，区域1的装饰应该被删除，这里的装饰应该被添加
    for i = 1, 150 do
        print("区域2 - 行" .. i)
        if i % 8 == 0 then
            CreateUnit("footman", i + 300, 400)  -- 测试增量添加
            CreateUnit("archer", i + 300, 500)
        end
        if i % 12 == 0 then
            CreateItem("sword", i, i)
            CreateItem("shield", i + 50, i + 50)
        end
    end
    
    -- 中间部分
    print("区域2中间部分")
    for i = 151, 200 do
        print("区域2中部 - 行" .. i)
        if i % 20 == 0 then
            CreateUnit("footman", 999, 999)  -- 测试装饰的精确性
        end
    end
    
    print("=== 区域2结束 ===")
end

-- ===== 区域3: 第501-750行 =====
-- 光标从区域2移动到这里时，测试重叠区域的保留
function TestRegion3()
    print("### 区域3开始 ###")
    
    -- 这个区域与区域2有重叠，测试保留机制
    for i = 1, 180 do
        print("区域3 - 行" .. i)
        
        -- 不同的引用模式测试
        if i % 5 == 0 then
            CreateUnit("footman", i * 2, i * 3)  -- 测试重叠区域保留
        end
        if i % 7 == 0 then
            CreateUnit("archer", i * 4, i * 5)
        end
        if i % 11 == 0 then
            CreateUnit("footman", i * 6, i * 7)  -- 更多footman引用
        end
    end
    
    -- 稠密的引用区域
    print("稠密引用测试区域")
    CreateUnit("footman", 1, 1)
    CreateUnit("archer", 2, 2)  
    CreateUnit("footman", 3, 3)
    CreateUnit("archer", 4, 4)
    CreateUnit("footman", 5, 5)
    CreateUnit("archer", 6, 6)
    CreateUnit("footman", 7, 7)
    CreateUnit("archer", 8, 8)
    
    print("### 区域3结束 ###")
end

-- ===== 区域4: 第751-1000行 =====
-- 最后的测试区域，测试完全不重叠的更新
function TestRegion4()
    print("@@@ 区域4开始 @@@")
    
    -- 当光标移动到这里时，应该完全删除之前的装饰，添加新的
    for i = 1, 200 do
        print("区域4 - 行" .. i)
        
        if i % 6 == 0 then
            CreateUnit("footman", i + 1000, i + 2000)  -- 测试完全新增
        end
        if i % 9 == 0 then
            CreateUnit("archer", i + 3000, i + 4000)
        end
        if i % 13 == 0 then
            GiveItemToUnit("footman", "sword")
            GiveItemToUnit("archer", "shield")
        end
    end
    
    -- 最后的测试块
    print("最终测试块")
    for i = 201, 250 do
        print("最终块 - 行" .. i)
        CreateUnit("footman", 9999, 9999)  -- 最后的装饰测试
    end
    
    print("@@@ 区域4结束 @@@")
    print("文件结束 - 总共约1000行")
end

-- 测试说明：
-- 1. 将光标放在第1行附近，应该看到区域1的装饰
-- 2. 移动光标到第300行，应该看到区域1装饰消失，区域2装饰出现
-- 3. 移动光标到第600行，应该看到部分区域2装饰保留，区域3装饰新增
-- 4. 移动光标到第900行，应该看到所有之前装饰删除，区域4装饰新增
-- 
-- 控制台应该显示：
-- "INI Config Navigator: 增量更新 - 新增[...] 删除[...] 保留[...]"
