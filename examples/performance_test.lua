-- 性能测试文件：大量引用来测试装饰器优化
-- 创建很多行来测试500行范围限制

function CreateManyUnits()
    -- 前面一些无关内容
    print("这是第1行")
    print("这是第2行")
    print("这是第3行")
    print("这是第4行")
    print("这是第5行")
    
    -- 这里有很多 footman 引用，但如果光标不在附近，不应该被装饰
    for i = 1, 100 do
        CreateUnit("footman", i * 10, 100)
        CreateUnit("archer", i * 10, 200)
        CreateUnit("footman", i * 10, 300)
        print("循环第" .. i .. "次")
    end
    
    -- 中间部分
    print("中间部分开始")
    for i = 1, 200 do
        print("填充行" .. i)
        if i % 10 == 0 then
            CreateUnit("footman", i, i)
        end
    end
    print("中间部分结束")
    
    -- 光标测试区域（第310行左右）
    print("=== 这里是光标测试区域 ===")
    CreateUnit("footman", 100, 200)  -- 这个应该被高亮
    CreateUnit("archer", 150, 250)   -- 这个也应该被高亮
    GiveItemToUnit("footman", "sword")
    CastSpell("footman", "fireball")
    print("=== 测试区域结束 ===")
    
    -- 后面又是很多内容
    for i = 1, 300 do
        print("后续填充行" .. i)
        if i % 20 == 0 then
            CreateUnit("archer", i, i)
        end
    end
    
    -- 最后部分（第650行左右）
    print("最后部分，如果光标在中间，这里不应该被装饰")
    CreateUnit("footman", 999, 999)
    CreateUnit("archer", 888, 888)
end

-- 添加更多行确保文件足够长
-- 这样我们可以测试500行限制是否生效
function AdditionalContent()
    print("额外内容开始")
    
    for i = 1, 500 do
        print("额外行" .. i)
        if i % 50 == 0 then
            CreateUnit("footman", i, i)  -- 这些只有在光标附近时才应该被装饰
        end
    end
    
    print("文件结束")
end
