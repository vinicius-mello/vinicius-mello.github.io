
local floor, infinite, random = math.floor, math.huge, math.random
local abs, max, min, ceil = math.abs, math.max, math.min, math.ceil
local gcd, invmodp, isInt, binomial, factorial
local fmodpow, primes
local factorize, factorization

local len = rawlen or function(a) return #a end

-- Number Theory
-- (kept ahead of the Kernel: Rat construction validates via gcd/isInt on
-- every call, and later code in this file constructs concrete Rat/Power
-- values at load time, not just inside deferred rule closures.)

gcd = function(a, b)
  while b ~= 0 do a, b = b, a % b end
  return abs(a)
end

invmodp = function(a, p)
  local t, newt = 0, 1
  local r, newr = p, a
  while newr ~= 0 do
    local quotient = floor(r/newr)
    t, newt = newt, t-quotient*newt
    r, newr = newr, r-quotient*newr
  end
  if r > 1 then
      error "a is not invertible"
  end
  if t < 0 then
      t = t+p
  end
  return t
end

isInt = function(a) return type(a) == 'number' and a == floor(a) end

binomial = function(n, k)
  if k > n then return nil end
  if k > n / 2 then k = n - k end
  local numer, denom = 1, 1
  for i = 1, k do
    numer = numer * (n - i + 1)
    denom = denom * i
  end
  return floor(numer / denom) -- lua 5.3
end

factorial = function(n)
  local r = 1
  for i=1,n do
    r = r*i
  end
  return r
end

--- Calculate the modular power for any exponent
fmodpow = function(bse, exp, mod)
  bse = bse % mod
  local prod = 1
  while exp > 0 do
    if exp % 2 == 1 then prod = prod * bse % mod end
    exp = floor(exp / 2)
    bse = (bse * bse) % mod
  end
  return prod
end

local function witnesses(n)
  if n < 1373653 then
    return 2, 3
  elseif n < 4759123141 then
    return 2, 7, 61
  elseif n < 2152302898747 then
    return 2, 3, 5, 7, 11
  elseif n < 3474749660383 then
    return 2, 3, 5, 7, 11, 13
  else
    return 2, 325, 9375, 28178, 450775, 9780504, 1795265022
  end
end

--- Given a number n, returns numbers r and d such that 2^r*d+1 == n
--- Miller-Rabin primality test
local function miller_rabin(n, ...)
  local s, d = 0, n - 1
  while d % 2 == 0 do d, s = d / 2, s + 1 end
  for i = 1, select('#', ...) do
    local witness = select(i, ...)
    if witness >= n then break end
    local x = fmodpow(witness, d, n)
    if (x ~= 1) then
      local t = s
      while x ~= n - 1 do
        t = t - 1
        if t <= 0 then return false end
        x = (x * x) % n
        if x == 1 then return false end
      end
    end
  end
  return true
end

local mrthreshold = 1e3

primes = setmetatable({
  2, 3 --[[just hard-code the even special case and following number]]
}, {
  __index = function(self, index)
    if type(index) == 'number' then
      for i = #self, index - 1 do local dummy = self[i] end -- Precalculate previous primes to avoid building up a stack
      for candidate = self[index - 1] + 2 --[[All primes >2 are odd]] , infinite do
        if index > mrthreshold then
          if miller_rabin(candidate, witnesses(candidate)) then
            rawset(self, index, candidate)
            return candidate
          end
        else
          local half = floor(candidate / 2)
          for i = 1, index - 1 do
            local div = self[i]
            if div > half then
              rawset(self, index, candidate);
              return candidate
            end -- A number can't possibly be divisible by something greater than its half
            if candidate % div == 0 then break end -- Candidate is divisible by a prime, this not prime itself
          end
        end
      end
    end
  end
})

factorize = function(subject)
  if subject == 1 then
    return -- Can be ommitted for implicit return ;)
  elseif subject > 0 then
    for i = 1, infinite do
      local candidate = primes[i]
      if subject % candidate == 0 then
        return candidate, factorize(subject / candidate)
      end
    end
  else
    return nil,
           "Can't be bothered to look up if negative numbers have a prime factorization"
  end
end

factorization = function(n)
  local a = {factorize(n)}
  local count = 0
  local cur = a[1]
  local r = {}
  for i = 1, len(a) + 1 do
    local ai = a[i]
    if ai == cur then
      count = count + 1
    else
      r[len(r) + 1] = {cur, count}
      cur = ai
      count = 1
    end
  end
  return r
end

-- Kernel
local guacyra = {}
guacyra.__symbols = {}

local Symbol = {'Symbol'}
Symbol[0] = Symbol
setmetatable(Symbol, guacyra)
guacyra.version = '0.7.1'

local function makeAtom(s)
  local t = {s}
  t[0] = Symbol
  setmetatable(t, guacyra)
  return t
end

local Int = makeAtom('Int')
local Rat = makeAtom('Rat')
local Str = makeAtom('Str')
local Bool = makeAtom('Bool')
local Fun = makeAtom('Fun')
local Nil = makeAtom('Nil')

guacyra.__symbols.Symbol = Symbol
guacyra.__symbols.Int = Int
guacyra.__symbols.Rat = Rat
guacyra.__symbols.Str = Str
guacyra.__symbols.Bool = Bool
guacyra.__symbols.Fun = Fun
guacyra.__symbols.Nil = Nil

-- lua 5.3 workaround
local unpack = unpack or table.unpack

local function isObject(e)
  return rawequal(getmetatable(e), guacyra)
end

local function isAtomHead(e)
  return rawequal(e, Symbol) or
    rawequal(e, Int) or
    rawequal(e, Rat) or
    rawequal(e, Str) or
    rawequal(e, Bool) or
    rawequal(e, Fun) or
    rawequal(e, Nil)
end

local function isAtom(e)
  local h = e[0]
  return rawequal(h, Symbol) or
    rawequal(h, Int) or
    rawequal(h, Rat) or
    rawequal(h, Str) or
    rawequal(h, Bool) or
    rawequal(h, Fun) or
    rawequal(e, Nil)
end
guacyra.isAtom = isAtom

local function isSymbol(e)
  return rawequal(e[0], Symbol)
end
guacyra.isSymbol = isSymbol

local function isFun(e)
  return rawequal(e[0], Fun)
end
guacyra.isFun = isFun

local _, __, ___

local function isBlank(e)
  local h = e[0]
  return rawequal(h, _) or
    rawequal(h, __) or
    rawequal(h, ___)
end

local Slot1, Slot2, Slot3

local function isSlot(e)
  return rawequal(e, Slot1) or
    rawequal(e, Slot2) or
    rawequal(e, Slot3)
end

local function lhead(e)
  if isSymbol(e) then
    return e
  else
    return lhead(e[0])
  end
end

local makeExp

local List

-- Best rational approximation of a float via continued-fraction convergents
-- (a linear search over denominators, tried first, can't reach eps=1e-15
-- within any reasonable denominator bound for a "generic" irrational).
local function floatToRat(a, eps, dmax)
  local h_prev, h = 1, floor(a)
  local k_prev, k = 0, 1
  local x = a
  while k < dmax and abs(h/k-a) > eps do
    local rem = x - floor(x)
    if rem < 1e-14 then break end
    x = 1/rem
    local ai = floor(x)
    h_prev, h = h, ai*h + h_prev
    k_prev, k = k, ai*k + k_prev
  end
  return h, k
end

local function conv(a)
  if not isObject(a) then
    local ta = type(a)
    if ta == 'number' then
      if a ~= floor(a) then
        local n, d = floatToRat(a, 1e-15, 1e7)
        a = Rat(n, d)
      else
        a = Int(a)
      end
    elseif ta == 'string' then
      a = Str(a)
    elseif ta == 'boolean' then
      a = Bool(a)
    elseif ta == 'table' then
      a = makeExp(List, unpack(a))
    elseif ta == 'function' then
      a = Fun(a)
    elseif ta == 'nil' then
      a = Nil
    end
  end
  return a
end

local eval, tostr

makeExp = function(h, ...)
  local t = {...}
  t[0] = h
  setmetatable(t, guacyra)
  if rawequal(h, Symbol) then
    if type(t[1]) ~= 'string' then
      error('Invalid symbol: Symbol(' .. tostr(t[1]) .. ')')
    end
    t.up = {}
    t.down = {}
    return t
  end
  if rawequal(h, Rat) then
    if not isInt(t[1]) or not isInt(t[2]) then
      error('Ill-formed Rat')
    end
    local d = gcd(t[1], t[2])
    t[1] = floor(t[1] / d) -- lua 5.3
    t[2] = floor(t[2] / d)
    if t[2] < 0 then
      t[2] = -t[2]
      t[1] = -t[1]
    end
    if t[2] == 1 then
      t[0] = Int
      t[2] = nil
    end
    return t
  end
  if isBlank(t)
    and type(t[1])=='table' and not isObject(t[1]) then
    local key = ''
    local type = _
    for k,v in pairs(t[1]) do
      if isSymbol(v) or isFun(v) then
        key = k
        type = v
      end
    end
    t[1]=Str(key)
    if not rawequal(type, _) then
      t[2] = type
    end
    t.isPattern = true
    return t
  end
  if not isAtomHead(h) then
    local f = false or t[0].isPattern
    for i = 1, len(t) do
      t[i] = conv(t[i])
      if isSlot(t[i]) then
        f = true
      end
      f = f or t[i].isPattern 
    end
    if not f then
      local r = eval(t)
      return r
    else
      t.isPattern = true
      return t
    end
  end
  return t
end
guacyra.__call = makeExp

local function cat(h, ...)
  local t
  t = {...}
  t[0] = h
  if not isAtomHead(h) then
    for i = 1, len(t) do
      t[i] = conv(t[i])
    end
  end
  setmetatable(t, guacyra)
  return t
end

local function Symbols(vl, global)
  local vars = {}
  for var in vl:gmatch("%S+") do
    local sym = Symbol(var)
    table.insert(vars, sym)
    if global then
      global[var] = sym
    end
  end
  return unpack(vars)
end

Slot1, Slot2, Slot3 = Symbols('Slot1 Slot2 Slot3')

local slots = {Slot1 = Slot1, Slot2 = Slot2, Slot3 = Slot3}

function guacyraOn()
  setmetatable(_G, {
  __index = function (tab , var)
    local r
    r = rawget(tab, var)
    if r~=nil then
      return r
    end
    r = guacyra.__symbols[var]
    if r == nil then
      local k,bl,h = string.match(var, "(%w*)(_+)(%w*)")
      if bl~=nil then
        local l = len(bl)
        if l == 1 and k == '' and (h=='1' or h=='2' or h=='3') then
          r = slots['Slot'..h]
        else
          if h ~= "" and guacyra.__symbols[h] == nil then
            error("Undefined head: "..h)
            return rawget(tab, var)
          end
          h = guacyra.__symbols[h] or _
          local t = {}
          t[k] = h
          if l == 1 then
            r = _(t)
          elseif l == 2 then
            r = __(t)
          elseif l == 3 then
            r = ___(t)
          end
          guacyra.__symbols[var] = r
        end
      else
        r = Symbol(var)
        guacyra.__symbols[var] = r
      end
    end
    return r
  end
})
end

function guacyraOff()
  setmetatable(_G,nil)
end

guacyraOn()

List = Symbols ('List', guacyra.__symbols)
_, __, ___ = Symbols '_ __ ___'

local True = Bool(true)
local False = Bool(false)
guacyra.__symbols.True = True
guacyra.__symbols.False = False

local function test(v)
  if isObject(v) and rawequal(v[0], Bool) then
    return v[1]
  end
  return v
end
guacyra.test = test

tostr = function(e)
  if not isObject(e) then return tostring(e) end
  local h = e[0]
  if rawequal(e, Slot1) then
    return '_1'
  end
  if rawequal(e, Slot2) then
    return '_2'
  end
  if rawequal(e, Slot3) then
    return '_3'
  end
  if isAtom(e) then
    if rawequal(h, Symbol) then return e[1] end
    if rawequal(h, Str) then return '"'.. e[1] ..'"' end
    if rawequal(h, Int) then return '' .. e[1] end
    if rawequal(h, Rat) then return '' .. e[1] .. '/' .. e[2] end
    if rawequal(h, Bool) then
      if e[1] then
        return 'True'
      else
        return 'False'
      end
    end
    if rawequal(h, Fun) then
      return e.name or tostring(e[1])
    end
    if rawequal(h, Nil) then
      return 'Nil'
    end
  end
  if rawequal(h, _) then
    if e[2] then
      return e[1][1] .. '_' .. tostr(e[2])
    else
      return e[1][1] .. '_'
    end
  end
  if rawequal(h, __) then
    if e[2] then
      return e[1][1] .. '__' .. tostr(e[2])
    else
      return e[1][1] .. '__'
    end
  end
  if rawequal(h, ___) then
    if e[2] then
      return e[1][1] .. '___' .. tostr(e[2])
    else
      return e[1][1] .. '___'
    end
  end
  local s, cs
  if rawequal(h, List) then
    s, cs = '{', '}'
  else
    s = tostr(h) .. '('
    cs = ')'
  end
  for i = 1, len(e) do
    if i > 1 then s = s .. ',' end
    s = s .. tostr(e[i])
  end
  s = s .. cs
  return s
end

guacyra.__tostring = tostr
guacyra.tostring = tostr

local function copy(ex)
  if isAtom(ex) then
    return ex
  else
    local r = {}
    for i = 0, len(ex) do r[i] = copy(ex[i]) end
    setmetatable(r, guacyra)
    return r
  end
end
guacyra.copy = copy

local function equal(ea, eb)
  local sa = len(ea)
  local sb = len(eb)
  if sa ~= sb then return false end
  if isAtom(ea) and isAtom(eb) then
    for i = 0, len(ea) do
      if ea[i] ~= eb[i] then return false end
    end
    return true
  end
  if not isAtom(ea) and not isAtom(eb) then
    for i = 0, len(ea) do
      if not equal(ea[i], eb[i]) then return false end
    end
    return true
  end
  return false
end
guacyra.equal = equal
guacyra.__eq = equal
guacyra.eq = function(a, b)
  return equal(a, conv(b))
end

local function has(ex, subex)
  if isAtom(ex) then
    return equal(ex, subex)
  end
  if equal(ex, subex) then
    return true
  else
    for i=1, len(ex) do
      if has(ex[i], subex) then
        return true
      end
    end
    return false
  end
end

local Numeric, Sequence, Plus, Times, Power =
  Symbols('Numeric Sequence Plus Times Power', guacyra.__symbols)

local function isRational(e)
  return rawequal(e[0], Int) or rawequal(e[0], Rat)
end

local function numericValue(e)
  if rawequal(e[0], Int) then
    return e[1]
  elseif rawequal(e[0], Rat) then
    return e[1] / e[2]
  end
end

local RatQ = Fun(
function(ex)
  return Bool(isRational(ex))
end)
guacyra.__symbols.RatQ = RatQ

local Mono, Poly = Symbols('Mono Poly', guacyra.__symbols)

-- Joel S. Cohen, Computer Algebra and Symbolic Computation: Mathematical Methods
local function less(u, v)
  -- O1
  if isRational(u) and isRational(v) then
    return numericValue(u) < numericValue(v)
  end
  if rawequal(u[0], Str) and rawequal(v[0], Str) then
    return u[1] < v[1]
  end
  -- O2
  if isSymbol(u) and isSymbol(v) then
    return u[1] < v[1]
  end
  -- O3
  if (rawequal(u[0], Plus) and rawequal(v[0], Plus))
  or (rawequal(u[0], Times) and rawequal(v[0], Times)) then
    local m = len(u)
    local n = len(v)
    while m > 0 and n > 0 do
      if equal(u[m], v[n]) then
        m = m - 1
        n = n - 1
      else
        return less(u[m], v[n])
      end
    end
    return m < n
  end
  -- O4
  if rawequal(u[0], Power) and rawequal(v[0], Power) then
    if equal(u[1], v[1]) then
      return less(u[2], v[2])
    else
      return less(u[1], v[1])
    end
  end
  -- O5.5
  if rawequal(u[0], Mono) and rawequal(v[0], Mono) then
    return Mono.order(u, v)
  end
  -- O6
  if rawequal(u[0], v[0]) then
    local m = len(u)
    local n = len(v)
    local i = 1
    while i <= m and i <= n do
      if equal(u[i], v[i]) then
        i = i + 1
      else
        return less(u[i], v[i])
      end
    end
    return m < n
  end
  -- O7
  if isRational(u) and not isRational(v) then
    return true
  elseif not isRational(u) and isRational(v) then
    return false
  end
  if isBlank(u) and not isBlank(v) then
    return true
  elseif not isBlank(u) and isBlank(v) then
    return false
  end
  -- O8
  if rawequal(u[0], Times) then
    return less(u, cat(Times, v))
  elseif rawequal(v[0], Times) then
    return less(cat(Times, u), v)
  end
  -- O9
  if rawequal(u[0], Power) then
    return less(u, cat(Power, v, 1))
  elseif rawequal(v[0], Power) then
    return less(cat(Power, u, 1), v)
  end
  -- O10
  if rawequal(u[0], Plus) then
    return less(u, cat(Plus, v))
  elseif rawequal(v[0], Plus) then
    return less(cat(Plus, u), v)
  end
  -- O12
  if isSymbol(v) and equal(u[0], v) then
    return false
  elseif isSymbol(u) and equal(u, v[0]) then
    return true
  end
  if isSymbol(v) then
    return false
  elseif isSymbol(u) then
    return true
  end
  -- Catch all
  return tostring(u) < tostring(v)
end

guacyra.less = less
guacyra.lt = function(a, b)
  return less(a, conv(b))
end
guacyra.gt = function(a, b)
  return less(conv(b), a)
end
guacyra.le = function(a, b)
  return guacyra.lt(a, b) or guacyra.eq(a, b)
end
guacyra.ge = function(a, b)
  return guacyra.gt(a, b) or guacyra.eq(a, b)
end

guacyra.__index = guacyra

local function subst(ex, sub)
  if isAtom(ex) then
    if rawequal(ex[0], Symbol) and sub[ex[1]] ~= nil then
      local a = conv(sub[ex[1]])
      return copy(a)
    else
      return ex
    end
  elseif isBlank(ex) then
    local t = tostr(ex)
    if sub[t] ~= nil then
      local a = conv(sub[t])
      return copy(a)
    else
      return ex
    end
  else
    local r = {}
    for i = 0, len(ex) do r[i] = subst(ex[i], sub) end
    setmetatable(r, guacyra)
    return r
  end
end
guacyra.subst = subst

local function matchR(ex, pat, cap)
  if isAtom(pat) then return equal(pat, ex) end
  if rawequal(pat[0], _) then
    local name = pat[1][1]
    local head = pat[2]
    if head ~= nil then
      if isFun(head) and not test(head[1](ex)) then
        return false
      elseif isSymbol(head) and not equal(ex[0], head) then
        return false
      end
    end
    if name == '' then return true end
    local en = rawget(cap, name)
    if en ~= nil then
      return equal(ex, en)
    else
      cap[name] = ex
      return true
    end
  end
  for i = 0, len(pat) do
    if (rawequal(pat[i][0], ___) or rawequal(pat[i][0], __)) and i ~=
      len(pat) then error('Blank sequence must be the last part: ' .. tostr(pat)) end
    if rawequal(pat[i][0], ___) or
      (rawequal(pat[i][0], __) and i <= len(ex)) then
      local name = pat[i][1][1]
      local head = pat[i][2]
      local exr = cat(Sequence)
      for j = i, len(ex) do
        exr[len(exr) + 1] = ex[j]
        if head ~= nil then
          if isFun(head) and not test(head[1](ex[j])) then
            return false
          elseif isSymbol(head) and not equal(ex[j][0], head) then
            return false
          end
        end
      end
      if name == '' then return true end
      local en = rawget(cap, name)
      if en ~= nil then
        return equal(en, exr)
      else
        cap[name] = exr
        return true
      end
    end
    if i > len(ex) then return false end
    if not matchR(ex[i], pat[i], cap) then return false end
  end
  if len(pat) < len(ex) then return false end
  return true
end
guacyra.match = function(exp, pat, cap)
  local cap2 = {}
  local ret = matchR(exp, pat, cap2)
  if ret then for k, v in pairs(cap2) do cap[k] = v end end
  return ret
end

local function getBlanksR(ex, r)
  if isAtom(ex) then
    return
  elseif isBlank(ex) and ex[2]==nil then
    local t = tostr(ex)
    r[t] = ex
  else
    for i = 0, len(ex) do getBlanksR(ex[i], r) end
  end
end

local function blanks(ex)
  local r = {}
  getBlanksR(ex, r)
  return r
end
guacyra.blanks = blanks

local function algSubst(ex)
  local bl = ex:blanks()
  local bs = {}
  for k,v in pairs(bl) do
    bs[#bs+1] = k
  end
  local n = #bs
  local s = 3^n
  local i = 0
  return function()
    local sub = {}
    if i == s then
      return nil
    end
    local k = i
    for j=1,n do
      local v = (k % 3) - 1
      local bsj = bs[j]
      if v<0 then
        sub[bsj] = bl[bsj]
      else
        sub[bsj] = Int(v)
      end
      k = floor(k / 3)
    end
    i = i + 1
    return sub
  end
end

local function tablelen(T)
  local count = 0
  for _ in pairs(T) do count = count + 1 end
  return count
end

-- orderless heads sort blanks before concrete terms (less(), rule O7), so a
-- leftover __/___ surviving a probe substitution can land anywhere; matchR
-- requires it last, so move it back before matching.
local function fixSeqBlankOrder(p)
  if isAtom(p) then return p end
  local n = len(p)
  for i = 1, n do
    local pi = p[i]
    if not isAtom(pi) and (rawequal(pi[0], __) or rawequal(pi[0], ___)) then
      if i ~= n then
        table.remove(p, i)
        p[n] = pi
      end
      break
    end
  end
  return p
end

local function algMatch(ex, pat, cap)
  local capm, ss
  local m = -1
  for s in algSubst(pat) do
    local cap2 = {}
    local p = fixSeqBlankOrder(pat:subst(s):eval(true))
    if matchR(ex, p, cap2) then
      local mm = tablelen(cap2)
      if mm>m then
        m, capm, ss = mm, cap2, s
      end
    end
  end
  if m<0 then return false end
  for k,v in pairs(capm) do
    cap[k] = v
  end
  for k,v in pairs(ss) do
    local kk = k:match('^(.-)_+$') or k
    if cap[kk] == nil then
      cap[kk] = v
    end
  end
  return true
end

guacyra.algMatch = algMatch

local function evalR(e, rec)
  --print('eval: ', e)
  local head = e[0]
  local ex = cat(head)
  if rec and not head.holdAll then
    for i = 1, len(e) do ex[i] = eval(e[i], rec) end
  else
    for i = 1, len(e) do ex[i] = e[i] end
  end
  if rawequal(head[0], Fun) then
    if isObject(head[1]) then
      return eval(head[1]:subst { Slot1=ex[1], Slot2=ex[2], Slot3=ex[3]}, true)
    end
    return eval(head[1](unpack(ex)))
  end
  local lh = lhead(head)
  if not lh.sequenceHold then
    local i = 1
    while i <= len(ex) do
      if rawequal(ex[i][0], Sequence) then
        local exi = table.remove(ex, i)
        for j = 1, len(exi) do table.insert(ex, i + j - 1, exi[j]) end
        i = i + len(exi)
      else
        i = i + 1
      end
    end
  end
  if lh.flat then
    local i = 1
    while i <= len(ex) do
      if equal(ex[i][0], head) then
        local exi = table.remove(ex, i)
        for j = 1, len(exi) do table.insert(ex, i + j - 1, exi[j]) end
        i = i + len(exi)
      else
        i = i + 1
      end
    end
  end
  if lh.orderless then table.sort(ex, less) end
  local tex
  for i = 1, len(ex) do
    local uphead = lhead(ex[i])
    if uphead.up then
      for j = 1, len(uphead.up) do
        tex = uphead.up[j](ex)
        if tex then
          return --[[eval]](tex)
        end
      end
    end
  end
  if lh.down then
    for j = 1, len(lh.down) do
      tex = lh.down[j](ex)
      if tex then
        return --[[eval]](tex)
      end
    end
  end
  return ex
end

eval = function(e, rec)
  if isAtom(e) then
    return e
  else
    return evalR(e, rec)
  end
end

guacyra.eval = eval
guacyra.val = function(ex)
  if isAtom(ex) then
    if isRational(ex) then
      return numericValue(ex)
    elseif rawequal(ex[0], Nil) then
      return nil
    else
      return ex[1]
    end
  end
  return ex
end

local function getArgs(pat)
  local args = {}
  local argt = {}
  local function tra(pat, args)
    if isAtom(pat) then
      return
    end
    if isBlank(pat) then
      local s = pat[1][1]
      if s ~= '' then
        if argt[s]==nil then
          argt[s] = true
          args[#args+1] = s
        end
      end
      return
    end
    for i=0,len(pat) do
      tra(pat[i], args)
    end
  end
  tra(pat, args)
  return args
end

--[[
local max_args = 10
local function getArgs(fun)
  local args = {}
  local hook = debug.gethook()
  local argHook = function( ... )
    local info = debug.getinfo(3)
    if 'pcall' ~= info.name then return end
    for i = 1, max_args do
      local name, value = debug.getlocal(2, i)
      if '(*temporary)' == name
        or '(temporary)' == name then
        debug.sethook(hook)
        error('')
        return
      end
      table.insert(args,name)
    end
  end
  debug.sethook(argHook, "c")
  pcall(fun)
  return args
end
]]

local function Rule(pat, fu, sym)
  local tab
  if not sym then
    sym = lhead(pat)
    tab = sym.down
  else
    tab = sym.up
  end
--  local args = getArgs(fu)
  local args = getArgs(pat)
  tab[len(tab)+1] = function(ex)
    local cap = {}
    if ex:match(pat, cap) then
      local cargs = {}
      for i=1,len(args) do cargs[len(cargs)+1] = cap[args[i]] end
      return fu(unpack(cargs))
    else
      return nil
    end
  end
end
guacyra.Rule = Rule

local function AlgRule(pat, fu, sym)
  local tab
  if not sym then
    sym = lhead(pat)
    tab = sym.down
  else
    tab = sym.up
  end
--  local args = getArgs(fu)
  local args = getArgs(pat)
  tab[len(tab)+1] = function(ex)
    local cap = {}
    if ex:algMatch(pat, cap) then
      local cargs = {}
      for i=1,len(args) do cargs[len(cargs)+1] = cap[args[i]] end
      return fu(unpack(cargs))
    else
      return nil
    end
  end
end
guacyra.AlgRule = AlgRule

local function replR(ex, pat, fu, lvl, args)
  local cap = {}
  if lvl==0 then
    return ex
  end
  if ex:match(pat, cap) then
    local cargs = {}
    for i=1,len(args) do cargs[len(cargs)+1] = cap[args[i]] end
    return fu(unpack(cargs))
  else
    if isAtom(ex) then
      return ex
    else
      local r = {}
      for i = 0, len(ex) do r[i] = replR(ex[i], pat, fu, lvl-1,args) end
      setmetatable(r, guacyra)
      return r
    end
  end
end

local function repl(ex, pat, fu, lvl)
  lvl = lvl or math.huge
--  local args = getArgs(fu)
  local args = getArgs(pat)
  return replR(ex, pat, fu, lvl, args):eval(true)
end
guacyra.repl = repl


Rule(Equal(a_, b_),
function(a, b) return Bool(equal(a, b)) end)
guacyra.EQ = Equal

Rule(Less(a_, b_),
function(a, b) return Bool(less(a, b)) end)
guacyra.LT = Less

Rule(GT(a_, b_),
function(a, b) return Bool(less(b, a)) end)

Rule(LE(a_, b_),
function(a, b) return Bool(less(a, b) or equal(a, b)) end)

Rule(GE(a_, b_),
function(a, b) return Bool(less(b, a) or equal(a, b)) end)

Rule(And(a__),
function(a)
  for i=1,len(a) do
    if not test(a[i]) then
      return False
    end
  end
  return True
end)

Rule(Or(a__),
function(a)
  for i=1,len(a) do
    if test(a[i]) then
      return True
    end
  end
  return False
end)

Rule(Not(a_),
function(a)
  if test(a) then
    return False
  end
  return True
end)

Rule(Numeric(a_),
function(a)
  return Bool(isRational(a))
end)

local NumericQ = Fun(
function(ex)
  return Numeric(ex)
end)
guacyra.__symbols.NumericQ = NumericQ

Rule(GCD(a_Int, b_Int),
function(a, b)
  return Int(gcd(a[1], b[1]))
end)

Rule(GCD(a_Int, l__Int),
function(a, l)
  return GCD(a, GCD(l))
end)

Rule(GCD(List(l__Int)),
function(l)
  return GCD(l)
end)

Rule(Binomial(a_Int, b_Int),
function(a, b)
  return Int(binomial(a[1], b[1]))
end)

Rule(Factorial(a_Int),
function(a)
  return Int(factorial(a[1]))
end)

Rule(Mod(a_Int, b_Int),
function(a, b)
  return Int(a[1] % b[1])
end)

Rule(Max(a_RatQ, b_RatQ),
function(a, b)
  if numericValue(a)>numericValue(b) then
    return a
  end
  return b
end)

Rule(Min(a_RatQ, b_RatQ),
function(a, b)
  if numericValue(a)<numericValue(b) then
    return a
  end
  return b
end)

Rule(Prime(a_Int),
function(a)
  a = numericValue(a)
  if a>0 then
    return Int(primes[a])
  end
  return nil
end)

Rule(Floor(a_RatQ),
function(a) return Int(floor(numericValue(a))) end)

Rule(Ceil(a_RatQ),
function(a) return Int(ceil(numericValue(a))) end)

Rule(Round(a_RatQ),
function(a) return Int(floor(numericValue(a)+0.5)) end)

Rule(Apply(a_, b_),
function(a, b)
  return a(unpack(b))
end)

Rule(Map(a_, b_),
function(a, b)
  local l = cat(List)
  for i=1,len(b) do
    l[len(l)+1] = a(b[i])
  end
  return  Apply(b[0], l)
end)

Rule(If(a_, b_, c_),
function(a, b, c)
  local t = eval(a, true)
  if test(t) then
    return eval(b, true)
  else
    return eval(c, true)
  end
end)
If.holdAll = true

Rule(First(a_(b_, c___)),
function(a, b, c)
  return b
end)

Rule(Rest(a_(b_, c___)),
function(a, b, c)
  return a(c)
end)

Rule(Reduce(a_, b_),
function(a, b)
  local r = b[1]
  for i = 2, len(b) do
    r = a(r, b[i])
  end
  return r
end)

Rule(Reduce(a_, b_, c_),
function(a, b, c)
  local r = c
  for i = 1, len(b) do
    r = a(r, b[i])
  end
  return r
end)

Rule(GroupWith(a_, b_),
function(a, b)
  local r = cat(List)
  local last = b[1]
  local l = cat(List, last)
  for i=2,len(b) do
    if test(a(last, b[i])) then
      l[len(l)+1] = b[i]
    else
      r[len(r)+1] = l
      last = b[i]
      l = cat(List, last)
    end
  end
  r[len(r)+1] = l
  return r
end)

Rule(Factor(a_Int),
function(a)
  return Apply(List, factorization(a[1]))
end)

Rule(Filter(a_, b_),
function(a, b)
  local l = cat(List)
  for i=1,len(b) do
    if test(a(b[i])) then
      l[len(l)+1] = b[i]
    end
  end
  return  Apply(b[0], l)
end)

Rule(Outer(a_, b_, c_),
function(a, b, c)
  local l = cat(List)
  for i=1,len(b) do
    local r = cat(List)
    for j=1,len(c) do
      r[len(r)+1] = a(b[i], c[j])
    end
    l[len(l)+1] = r
  end
  return l
end)

Rule(Cat(c___),
function(c)
  local t = ""
  for i = 1, len(c) do
    if isAtom(c[i]) and rawequal(c[i][0], Str) then
      t = t .. (c[i][1])
    else
      t = t .. (c[i]:tostring())
    end
  end
  return Str(t)
end)

Rule(Sub(s_Str, {a_Int, b_Int}),
function(s, a, b)
  return Str(string.sub(#s, #a, #b))
end)

Rule(Range(a_Int, b_Int),
function(a, b)
  local t = cat(List)
  local d = 1
  if a[1]>b[1] then
    d = -1
  end
  for i = a[1], b[1], d do
    t[len(t)+1] = Int(i)
  end
  return t
end)

Rule(Range(a_RatQ, b_RatQ, c_RatQ),
function(a, b, c)
  local t = cat(List)
  local na, nb =
    numericValue(a), numericValue(b)
  c = Abs(c)
  if na>nb then
    c = -c
  end
  local nc = numericValue(c)
  for i = na, nb, nc do
    t[len(t)+1] = a
    a = a+c
  end
  return t
end)

Rule(Range(b_Int),
function(b)
  local t = cat(List)
  local a = 1
  if b[1]<0 then
    a = -1
  end
  for i = a, b[1], a do
    t[len(t)+1] = Int(i)
  end
  return t
end)

Rule(Rand({a_Int, b_Int}),
function(a, b)
  return Int(random(a[1], b[1]))
end)

Rule(Rand({a_Int, b_Int}, n_Int),
function(a, b, n)
  local t = cat(List)
  for i = 1, n[1] do
    t[len(t)+1] = Int(random(a[1], b[1]))
  end
  return t
end)

Rule(Shuffle(a_List),
function(a)
  a = copy(a)
  for i = len(a),2,-1 do
    local j = random(1, i)
     a[i], a[j] = a[j], a[i]
  end
  return a
end)

Rule(Choose(n_Int, m_Int),
function(n, m)
  -- https://stackoverflow.com/questions/2394246/algorithm-to-select-a-single-random-combination-of-values
  local s = List()
  for j= n[1]-m[1]+1,n[1] do
    local t = Rand({1, j})
    local f = true
    for i=1,len(s) do
      if s[i]:eq(t) then
        s[len(s)+1] = Int(j)
        f = false
        break
      end
    end
    if f then
      s[len(s)+1] = t
    end
  end
  table.sort(s, less)
  return s
end)

Rule(Choose(l_List, m_Int),
function(l, m)
  local n = len(l)
  if m:eq(1) then
    return l[Rand({1,n})[1]]
  end
  local r = Choose(n, m)
  return Map(function(i) return l[i[1]] end, r)
end)

Rule(Index(a_, i_Int),
function(a, i)
  return a[i[1]]
end)

Rule(Index(a_, i_Int, j_Int),
function(a, i, j)
  return a[i[1]][j[1]]
end)

Rule(Append(a_, b_),
function(a, b)
  a[len(a)+1] = b
  return a
end)

guacyra.__add = Plus
guacyra.__sub = function(a, b) return Plus(a, Times(-1, b)) end
guacyra.__unm = function(a) return Times(-1, a) end
guacyra.__mul = Times
guacyra.__div = function(a, b) return Times(a, Power(b, -1)) end
guacyra.__pow = Power
local val = function(a)
  if isAtom(a) then
    if rawequal(a[0], Rat) then
      return a[1]/a[2]
    elseif rawequal(a, Nil) then
      return nil
    end
    return a[1]
  end
  return len(a)
end
guacyra.val = val
guacyra.__len = val

Plus.flat = true
Plus.orderless = true
Rule(Plus(),
function() return Int(0) end)

Rule(Plus(a_),
function(a) return a end)

Rule(Plus(a_Int, b_Int),
function(a, b) return Int(a[1]+b[1]) end)

Rule(Plus(a_Int, b_Rat),
function(a, b) return Rat(a[1]*b[2]+b[1], b[2]) end)

Rule(Plus(a_Rat, b_Int),
function(a, b) return Rat(b[1]*a[2]+a[1], a[2]) end)

Rule(Plus(a_Rat, b_Rat),
function(a, b) return Rat(a[1]*b[2]+b[1]*a[2], a[2]*b[2]) end)

Rule(Plus(0, a__),
function(a) return Plus(a) end)

Rule(Plus(a_, a_),
function(a)
  return Times(2, a)
end)

Times.flat = true
Times.orderless = true
Rule(Times(),
function() return Int(1) end)

Rule(Times(a_),
function(a) return a end)

Rule(Times(a_Int, b_Int),
function(a, b) return Int(a[1]*b[1]) end)

Rule(Times(a_Int, b_Rat),
function(a, b) return Rat(a[1]*b[1], b[2]) end)

Rule(Times(a_Rat, b_Int),
function(a, b) return Rat(b[1]*a[1], a[2]) end)

Rule(Times(a_Rat, b_Rat),
function(a, b) return Rat(a[1]*b[1], a[2]*b[2]) end)

Rule(Times(1, b__),
function(b) return Times(b) end)

Rule(Times(0, b__),
function(b) return Int(0) end)

Rule(Times(c_NumericQ, Plus(a__)),
function(c, a)
  local r = Map(function(t) return Times(c, t) end, List(a))
  return Apply(Plus, r)
end)

Rule(Times(a_, a_),
function(a)
  return Power(a, 2)
end)

Rule(Plus(a__),
function(a)
  if len(a)==2 then
    return nil
  end
  local last = a[1]
  local flag = false
  local l = cat(List)
  for i=2,len(a) do
    local ca = cat(Plus, last, a[i])
    local p = Plus(last, a[i])
    if equal(ca, p) then
      l[len(l)+1] = last
      last = a[i]
    else
      flag = true
      last = p
    end
  end
  l[len(l)+1] = last
  if flag then
    return Apply(Plus, l)
  else
    return nil
  end
end)

Rule(Times(a__),
function(a)
  if len(a)==2 then
    return nil
  end
  local last = a[1]
  local flag = false
  local l = cat(List)
  for i=2,len(a) do
    local ca = cat(Times, last, a[i])
    local p = Times(last, a[i])
    if equal(ca, p) then
      l[len(l)+1] = last
      last = a[i]
    else
      flag = true
      last = p
    end
  end
  l[len(l)+1] = last
  if flag then
    return Apply(Times, l)
  else
    return nil
  end
end)

Rule(Plus(Times(a__), Times(a__)),
function(a)
  return Times(2, a)
end, Times)

Rule(Plus(Times(a__), Times(c_NumericQ, a__)),
function(a, c)
  return Times(Plus(c, 1), a)
end, Times)

Rule(Plus(Times(c_NumericQ, a__), Times(d_NumericQ, a__)),
function(c, a, d)
  return Times(Plus(c, d), a)
end, Times)

Rule(Plus(a_, Times(c_NumericQ, a_)),
function(a, c)
  return Times(Plus(c, 1), a)
end, Times)

Rule(a_^0,
function(a) return Int(1) end)

Rule(1^e_,
function(e) return Int(1) end)

Rule(a_^1,
function(a) return a end)

Rule(a_Int^b_Int,
function(a, b)
  if b[1] < 0 then
    return Rat(1, floor(a[1] ^ (-b[1])))
  elseif b[1] > 0 then
    return Int(floor(a[1] ^ b[1]))
  end
end)

Rule(p_Rat^b_Int,
function(p, b)
  if b[1] < 0 then
    return Rat(floor(p[2]^(-b[1])), floor(p[1]^(-b[1])))
  elseif b[1] > 0 then
    return Rat(floor(p[1]^b[1]), floor(p[2]^b[1]))
  end
end)

Rule(a_Int^p_Rat,
function(a, p)
  local function root(fac, p, q)
    local u, v = 1, 1
    for i = 1, len(fac) do
      local fip = fac[i][2] * p
      local prime = fac[i][1]
      local a = floor(fip / q)
      local b = fip - a * q
      u = u * floor(prime ^ a)
      v = v * floor(prime ^ b)
    end
    return u, v
  end
  if a[1] > 0 then
    if p[1] > 0 then
      local fact = factorization(a[1])
      local u, v = root(fact, p[1], p[2])
      if u == 1 and p[1] == 1 then
        return nil
      else
        return Times(u, Power(v, Rat(1, p[2])))
      end
    else
      local fact = factorization(a[1])
      p[1] = -p[1]
      local k = floor(p[1] / p[2])
      local r = p[1] - k * p[2]
      local u, v = root(fact, p[2] - r, p[2])
      return Times(Rat(u, a[1] ^ (k + 1)), Power(v, Rat(1, p[2])))
    end
  end
end)

Rule(a_Rat^p_Rat,
function(a, p)
  return Times(Power(Int(a[1]), p),
    Power(Int(a[2]), Rat(-p[1], p[2])))
end)

Rule(Power(Power(a_, b_), c_),
function(a, b, c)
  return Power(a, b * c)
end)

Rule(Power(Times(a__), b_),
function(a, b)
  return Apply(Times,
    Map(function(t) return Power(t, b) end, List(a)))
end)

Rule(Times(a_, Power(a_, e_)),
function(a, e)
  if rawequal(a[0], Int) then
    return nil
  else
    return Power(a, Plus(e, 1))
  end
end, Power)

Rule(Times(Power(a_, e_), a_),
function(a, e)
  if rawequal(a[0], Int) then
    return nil
  else
    return Power(a, Plus(e, 1))
  end
end, Power)

Rule(Times(Power(a_, e_),
           Power(a_, f_)),
function(a, e, f)
  return Power(a, Plus(e, f))
end, Power)

Rule(Times(Power(a_Int, c_RatQ),
           Power(b_Int, c_RatQ)),
function(a, c, b)
  return Power(Times(a, b), c)
end, Power)

Rule(Sqrt(a_),
function(a) return a^Rat(1,2) end)

Rule(Expand(Times(a_, Plus(b_, c_))),
function(a, b, c)
  return Plus(Expand(Times(a, b)), Expand(Times(a, c)))
end)

Rule(Expand(Times(a_, Plus(b_, c__))),
function(a, b, c)
  return Plus(Expand(Times(a, b)), Expand(Times(a, Plus(c))))
end)

Rule(Expand(Power(Plus(a_, b_), n_Int)),
function(a, b, n)
  if n[1] < 0 then return nil end -- binomial expansion isn't defined for negative exponents; leave e.g. 1/(x-1) unexpanded rather than looping zero times into a bogus Plus()=0
  local l = cat(List)
  for i=0,n[1] do
    l[len(l)+1] = Expand(
      Times(binomial(n[1], i),
        Expand(Power(a,i)),
        Expand(Power(b,n[1]-i))))
  end
  return Apply(Plus, l)
end)

Rule(Expand(Power(Plus(a_, b__), n_Int)),
function(a, b, n)
  if n[1] < 0 then return nil end
  local l = cat(List)
  for i=0,n[1] do
    l[len(l)+1] = Expand(
      Times(binomial(n[1], i),
        Expand(Power(a,i)),
        Expand(Power(Plus(b),n[1]-i))))
  end
  return Apply(Plus, l)
end)

Rule(Expand(Plus(a__)),
function(a)
  return Apply(Plus, Map(Expand, List(a)))
end)
Rule(Expand(Times(a_,b__)),
function(a, b)
  local tb =Times(b)
  local t = Expand(tb)
  if equal(t, tb) then
    return nil
  else
    return Expand(Times(a, t))
  end
end)

Rule(Expand(a_),
function(a)
  return a
end)

Rule(NumDen(p_Rat),
function(p)
  return List(p[1], p[2])
end)

Rule(NumDen(a_Int),
function(a)
  return List(a[1], 1)
end)

Rule(NumDen(Power(a_, b_Int)),
function(a, b)
  if b[1]<0 then
    return List(1, Power(a, -b[1]))
  else
    return List(Power(a, b), 1)
  end
end)

Rule(NumDen(Power(a_, q_Rat)),
function(a, q)
  if q[1]<0 then
    return List(1, Power(a, Rat(-q[1],q[2])))
  else
    return List(Power(a, q), 1)
  end
end)

Rule(NumDen(Times(a__)),
function(a)
  local e = Map(NumDen, List(a))
  local num = cat(Times)
  local den = cat(Times)
  for i=1,len(e) do
    num[len(num)+1] = e[i][1]
    den[len(den)+1] = e[i][2]
  end
  return List(eval(num), eval(den))
end)

Rule(NumDen(Plus(a__)),
function(a)
  local e = Map(NumDen, List(a))
  local num = cat(Plus)
  local den = cat(Times)
  local t = {}
  for i=1,len(e) do
    local ei = e[i][2]
    local eis = ei:tostring()
    if not t[eis] then
      t[eis] = true
      den[len(den)+1] = ei
    end
  end
  for i=1,len(e) do
    local r = (den:copy())*e[i][1]/e[i][2]
    num[len(num)+1] = r
  end
  return List(eval(num), eval(den))
end)

Rule(NumDen(a_),
function(a)
  return List(a, 1)
end)

Rule(Num(a_),
function(a)
  local nd = NumDen(a)
  return nd[1]
end)

Rule(Den(a_),
function(a)
  local nd = NumDen(a)
  return nd[2]
end)

Rule(Together(a_),
function(a)
  local l = NumDen(a)
  if rawequal(l[2][0], Int) then
    return l[1]/l[2]
  else
    return l[1]/l[2]
  end
end)

Rule(Set(c__),
function(c)
  local r = cat(Set, c[1])
  local flag = false
  for i = 2,len(c) do
    if not equal(c[i], c[i-1]) then
      r[len(r)+1] = c[i]
    else
      flag = true
    end
  end
  if flag then
    return r
  end
  return nil
end)
Set.orderless = true

Rule(Union(a_Set, b_Set),
function(a, b)
  local r = Apply(List, a)
  for i=1,len(b) do r[len(r)+1] = b[i] end
  return Apply(Set, r)
end)

Rule(Intersection(a_Set, b_Set),
function(a, b)
  local r = cat(Set)
  local i = 1
  local j = 1
  while i<=len(a) and j<=len(b) do
    if less(a[i],b[j]) then
      i = i+1
    elseif less(b[j], a[i]) then
      j = j+1
    else
      r[len(r)+1] = a[i]
      i = i+1
      j = j+1
    end
  end
  return r
end)

Rule(In(a_, b_Set),
function(a, b)
  for i=1,len(b) do
    if equal(a, b[i]) then
      return True
    end
  end
  return False
end)

Rule(Subset(a_Set, b_Set),
function(a, b)
  for i=1,len(a) do
    if not In(a[i], b):test() then
      return False
    end
  end
  return True
end)

Rule(PowerSet(a_Set),
function(a)
  local r = Set()
  for i=0,(2^len(a))-1 do
    local s = Set()
    local j = i
    local k = 1
    while j~=0 do
      if j%2==1 then
        s = Union(s,Set(a[k]))
      end
      k = k+1
      j = floor(j/2)
    end
    r = Union(r,Set(s))
  end
  return r
end)

Tuple.orderless = false

Rule(Plus(a_Tuple, b_Tuple),
function(a, b)
  local n = len(a)
  if n==len(b) then
    local r = Tuple()
    for i=1,n do r[i]=a[i]+b[i] end
    return r
  else
    return nil
  end
end)

Rule(Times(a_, b_Tuple),
function(a, b)
  local n = len(b)
  local r = Tuple()
  for i=1,n do r[i]=a*b[i] end
  return r
end)

Rule(Dot(a_Tuple, b_Tuple),
function(a, b)
  local n = len(a)
  if n==len(b) then
    local r = 0
    for i=1,n do r=r+a[i]*b[i] end
    return r
  else
    return nil
  end
end)

Rule(Cross(a_Tuple, b_Tuple),
function(a, b)
  if len(a)==3 and len(b)==3 then
    local l = Tuple()
    l[1] = a[2]*b[3]-a[3]*b[2]
    l[2] = a[3]*b[1]-a[1]*b[3]
    l[3] = a[1]*b[2]-a[2]*b[1]
    return l
  else
    return nil
  end
end)

local function deg(m)
  local r = 0
  local l = m[2]
  for i=1,len(l) do
    r = r+l[i][1]
  end
  return r
end

local function deglex(m1, m2)
  local d1, d2 = deg(m1), deg(m2)
  if d1<d2 then
    return false
  elseif d1>d2 then
    return true
  end
  return less(m2[2], m1[2])
end

Mono.order = deglex

Rule(Power(Mono(c_NumericQ, l_Tuple), p_Int),
function(c, l, p)
  return Mono(c^p, p*l)
end, Mono)

Rule(Times(n_Mono, m_Mono),
function(n, m)
  return Mono(n[1]*m[1], n[2]+m[2])
end, Mono)

Rule(Times(c_NumericQ, m_Mono),
function(c, m)
  return Mono(c*m[1], m[2])
end, Mono)

Rule(Times(m_Mono, c_NumericQ),
function(m, c)
  return Mono(c*m[1], m[2])
end, Mono)

Poly.orderless = true
Poly.flat = true
Rule(Poly(m__Mono),
function(m)
  local r = cat(Poly)
  local f = true
  local c = m[1][1]
  local last = m[1][2]
  for i=2,len(m) do
    if equal(m[i][2], last) then
      f = false
      c = c+m[i][1]
    else
      if not equal(c, Int(0)) then
        r[len(r)+1] = Mono(c, last)
      else
        f = false
      end
      c = m[i][1]
      last = m[i][2]
    end
  end
  if not equal(c, Int(0)) then
    r[len(r)+1] = Mono(c, last)
  else
    f = false
  end
  if f then
    return nil
  end
  return r
end)

local function isPolynomial(p, var)
  if isSymbol(p) then
    var[p[1]] = p
    return true
  elseif Numeric(p):test() then
    return true
  elseif rawequal(p[0], Plus) or rawequal(p[0], Times) then
    for i=1,len(p) do
      if not isPolynomial(p[i], var) then
        return false
      end
    end
    return true
  elseif rawequal(p[0], Power) then
    if isPolynomial(p[1], var)
      and rawequal(p[2][0], Int) and p[2][1]>0 then
      return true
    end
  end
  return false
end

local function isMonomial(p, var)
  if isSymbol(p) then
    var[p[1]] = p
    return true
  elseif Numeric(p):test() then
    return true
  elseif rawequal(p[0], Power) then
    if isSymbol(p[1])
      and rawequal(p[2][0], Int) and p[2][1]>0 then
      var[p[1][1]] = p[1]
      return true
    end
  elseif rawequal(p[0], Times) then
    for i=1,len(p) do
      if not isMonomial(p[i], var) then
        return false
      end
    end
    return true
  end
  return false
end

local function isExpandedPolynomial(p, var)
  if isMonomial(p, var) then
    return true
  elseif rawequal(p[0], Plus) then
    for i=1,len(p) do
      if not isMonomial(p[i], var) then
        return false
      end
    end
    return true
  end
  return false
end

local function expToPoly(p, var)
  local s = {}
  for k,v in pairs(var) do
    s[len(s)+1] = k
  end
  table.sort(s)
  s = Poly.vars or conv(s)
  local subs = {}
  local n = len(s)
  local l = cat(Tuple)
  for i=1,n do l[i] = Int(0) end
  for i=1,n do
    local ll = copy(l)
    ll[i] = Int(1)
    subs[s[i][1]] = cat(Mono, 1, ll)
  end
  subs['Plus'] = Poly
  local r = p:subst(subs)
  r = r:repl(a_NumericQ, function(a) return Mono(a, l) end, 2)
  r = r:eval(true)
  return r, s
end

-- Univariate polynomial toolkit (PolyQuotient/PolyRemainder/PolyGCD/Factor/
-- Cancel/CoefficientList): operates on plain Lua arrays of guacyra Int/Rat
-- coefficients in DESCENDING degree order (arr[1] = leading coefficient),
-- independent of the multivariate Mono/Poly representation above, which has
-- no division/GCD operations of its own.

-- classifies a single Expand()ed summand as c*x^k, returning (k, c); nil if
-- the term isn't a simple power of x times a factor free of x.
local function termCoeff(term, x)
  if not has(term, x) then
    return 0, term
  end
  if equal(term, x) then
    return 1, Int(1)
  end
  if rawequal(term[0], Power) and equal(term[1], x)
    and rawequal(term[2][0], Int) and term[2][1] >= 0 then
    return term[2][1], Int(1)
  end
  if rawequal(term[0], Times) then
    local k, c = 0, Int(1)
    for i = 1, len(term) do
      local f = term[i]
      if not has(f, x) then
        c = c * f
      elseif equal(f, x) then
        k = k + 1
      elseif rawequal(f[0], Power) and equal(f[1], x)
        and rawequal(f[2][0], Int) and f[2][1] >= 0 then
        k = k + f[2][1]
      else
        return nil
      end
    end
    return k, c
  end
  return nil
end

-- p (in x) -> array of Int/Rat coefficients, descending degree, leading
-- zeros trimmed; nil if p isn't a polynomial in x of the shape termCoeff
-- understands.
local function coeffArray(p, x)
  local e = Expand(p)
  local terms = rawequal(e[0], Plus) and e or cat(Plus, e)
  local coeffs, maxk = {}, 0
  for i = 1, len(terms) do
    local k, c = termCoeff(terms[i], x)
    if k == nil then return nil end
    coeffs[k] = (coeffs[k] or Int(0)) + c
    if k > maxk then maxk = k end
  end
  while maxk > 0 and equal(coeffs[maxk] or Int(0), Int(0)) do
    maxk = maxk - 1
  end
  local arr = {}
  for k = maxk, 0, -1 do
    arr[#arr+1] = coeffs[k] or Int(0)
  end
  return arr, maxk
end

-- inverse of coeffArray
local function arrayToPoly(arr, x)
  local n = #arr - 1
  local result = Int(0)
  for i = 1, #arr do
    local k = n - (i - 1)
    local c = arr[i]
    if not equal(c, Int(0)) then
      result = result + (k == 0 and c or c * x^k)
    end
  end
  return result
end

-- schoolbook long division on descending-degree coefficient arrays
local function polyDivMod(A, B)
  local dA, dB = #A - 1, #B - 1
  if dA < dB then
    return {Int(0)}, A
  end
  local rem = {}
  for i = 1, #A do rem[i] = A[i] end
  local q = {}
  local lcB = B[1]
  for i = 1, dA - dB + 1 do
    local coef = rem[i] / lcB
    q[i] = coef
    if not equal(coef, Int(0)) then
      for j = 1, #B do
        rem[i+j-1] = rem[i+j-1] - coef*B[j]
      end
    end
  end
  local remainder = {}
  for i = dA - dB + 2, #rem do remainder[#remainder+1] = rem[i] end
  if #remainder == 0 then remainder = {Int(0)} end
  while #remainder > 1 and equal(remainder[1], Int(0)) do
    table.remove(remainder, 1)
  end
  return q, remainder
end

-- Euclidean algorithm; result is monic (never mutates A or B).
local function polyGCDArr(A, B)
  local a, b = A, B
  while not (#b == 1 and equal(b[1], Int(0))) do
    local _, r = polyDivMod(a, b)
    a, b = b, r
  end
  if #a == 1 and equal(a[1], Int(0)) then
    return a
  end
  local lc = a[1]
  local g = {}
  for i = 1, #a do g[i] = a[i] / lc end
  return g
end

Rule(PolyQuotient(a_, b_, x_Symbol),
function(a, b, x)
  local A, B = coeffArray(a, x), coeffArray(b, x)
  if A == nil or B == nil or (#B == 1 and equal(B[1], Int(0))) then
    return nil
  end
  return arrayToPoly((polyDivMod(A, B)), x)
end)

Rule(PolyRemainder(a_, b_, x_Symbol),
function(a, b, x)
  local A, B = coeffArray(a, x), coeffArray(b, x)
  if A == nil or B == nil or (#B == 1 and equal(B[1], Int(0))) then
    return nil
  end
  local _, R = polyDivMod(A, B)
  return arrayToPoly(R, x)
end)

Rule(PolyGCD(a_, b_, x_Symbol),
function(a, b, x)
  local A, B = coeffArray(a, x), coeffArray(b, x)
  if A == nil or B == nil then return nil end
  return arrayToPoly(polyGCDArr(A, B), x)
end)

Rule(CoefficientList(p_, x_Symbol),
function(p, x)
  local A = coeffArray(p, x)
  if A == nil then return nil end
  local asc = {}
  for i = #A, 1, -1 do asc[#asc+1] = A[i] end
  return Apply(List, asc)
end)

local function divisorsOfInt(n)
  n = abs(n)
  if n == 0 then return {1} end
  local ds = {}
  for d = 1, n do
    if n % d == 0 then ds[#ds+1] = d end
  end
  return ds
end

local function rationalRootCandidates(a0, an)
  local pds, qds = divisorsOfInt(a0[1]), divisorsOfInt(an[1])
  local seen, cands = {}, {}
  for _, p in ipairs(pds) do
    for _, q in ipairs(qds) do
      for _, sgn in ipairs({1, -1}) do
        local r = Rat(sgn*p, q)
        local key = tostr(r)
        if not seen[key] then
          seen[key] = true
          cands[#cands+1] = r
        end
      end
    end
  end
  return cands
end

local function evalArrAt(arr, v)
  local r = arr[1]
  for i = 2, #arr do r = r*v + arr[i] end
  return r
end

local function findRationalRoot(cur, candidates)
  if equal(cur[#cur], Int(0)) then return Int(0) end
  for i = 1, #candidates do
    if equal(evalArrAt(cur, candidates[i]), Int(0)) then
      return candidates[i]
    end
  end
  return nil
end

-- Extracts rational linear factors via the rational root theorem; any
-- remaining irreducible-over-Q factor (degree >= 2, or degree 1 with an
-- irrational-only... n/a here since roots are always rational by
-- construction) is left as a single opaque cofactor. Only handles
-- univariate polynomials with integer coefficients; anything else is left
-- unevaluated (returns nil) so Factor(Int) and the identity fallback still
-- apply.
Rule(Factor(p_),
function(p)
  local vars = {}
  if not isPolynomial(p, vars) then return nil end
  local x, nvars = nil, 0
  for _, v in pairs(vars) do nvars = nvars + 1; x = v end
  if nvars ~= 1 then return nil end
  local A = coeffArray(p, x)
  if A == nil or #A <= 1 then return nil end
  for i = 1, #A do
    if not rawequal(A[i][0], Int) then return nil end
  end
  local candidates = rationalRootCandidates(A[#A], A[1])
  local roots, cur = {}, A
  while #cur - 1 >= 1 do
    local root = findRationalRoot(cur, candidates)
    if root == nil then break end
    roots[#roots+1] = root
    cur = (polyDivMod(cur, coeffArray(x - root, x)))
  end
  if #roots == 0 then return nil end
  table.sort(roots, less)
  local result = Int(1)
  local i = 1
  while i <= #roots do
    local j = i
    while j < #roots and equal(roots[j+1], roots[i]) do j = j + 1 end
    local mult = j - i + 1
    local factor = x - roots[i]
    result = result * (mult == 1 and factor or factor^mult)
    i = j + 1
  end
  local remainder = arrayToPoly(cur, x)
  if not equal(remainder, Int(1)) then
    result = result * remainder
  end
  return result
end)

Rule(Cancel(a_),
function(a)
  local nd = NumDen(a)
  local num, den = nd[1], nd[2]
  local varsN, varsD = {}, {}
  if not isPolynomial(num, varsN) or not isPolynomial(den, varsD) then
    return Together(a)
  end
  local x
  for k, v in pairs(varsN) do
    if varsD[k] then x = v end
  end
  if not x then return Together(a) end
  local An, Ad = coeffArray(num, x), coeffArray(den, x)
  if An == nil or Ad == nil then return Together(a) end
  local G = polyGCDArr(An, Ad)
  if #G <= 1 then return Together(a) end
  local newNum = arrayToPoly((polyDivMod(An, G)), x)
  local newDen = arrayToPoly((polyDivMod(Ad, G)), x)
  return newNum/newDen
end)

-- Simplify: tries a handful of standard strategies (identity, Expand,
-- Cancel, Expand-then-Cancel) and keeps whichever has the fewest nodes.
-- Never worse than the input since the input itself is always a candidate;
-- not a general simplifier (no trig identities, no CSE).
local function nodeCount(e)
  if isAtom(e) then return 1 end
  local c = 1
  for i = 1, len(e) do c = c + nodeCount(e[i]) end
  return c
end

Rule(Simplify(e_),
function(e)
  local best, bestC = e, nodeCount(e)
  local candidates = {Expand(e), Cancel(e), Cancel(Expand(e))}
  for i = 1, #candidates do
    local c = nodeCount(candidates[i])
    if c < bestC then
      best, bestC = candidates[i], c
    end
  end
  return best
end)

-- Solve(expr, x): solves expr == 0 for x, returning the solution Set (empty
-- Set() means provably no solution; an unevaluated Solve(...) means "not
-- solved", not "no solution"). Linear and quadratic are closed-form;
-- quadratic promotes to a proper Complex(...) result on negative discriminant
-- (I, the imaginary unit, is a genuine Lua global set up later in this file
-- -- looked up at call time, so the forward reference is fine). Degree >= 3
-- peels rational roots via the Factor machinery above and, if what's left
-- reduces to degree <= 2, finishes with the same closed forms; an
-- irreducible residual of degree >= 3 is left unsolved.
local function solveQuadratic(a, b, c)
  local D = Expand(b*b - 4*a*c)
  if isRational(D) then
    if equal(D, Int(0)) then
      return Set(-b/(2*a))
    elseif numericValue(D) > 0 then
      local sq = Sqrt(D)
      return Set((-b-sq)/(2*a), (-b+sq)/(2*a))
    else
      local sq = Sqrt(-D)
      return Set(Complex(-b/(2*a), -sq/(2*a)), Complex(-b/(2*a), sq/(2*a)))
    end
  else
    local sq = Sqrt(D)
    return Set((-b-sq)/(2*a), (-b+sq)/(2*a))
  end
end

local function solveHigherDegree(A, x)
  for i = 1, #A do
    if not rawequal(A[i][0], Int) then return nil end
  end
  local candidates = rationalRootCandidates(A[#A], A[1])
  local roots, cur = {}, A
  while #cur - 1 >= 1 do
    local root = findRationalRoot(cur, candidates)
    if root == nil then break end
    roots[#roots+1] = root
    cur = (polyDivMod(cur, coeffArray(x - root, x)))
  end
  local sols = {}
  for i = 1, #roots do sols[#sols+1] = roots[i] end
  local remDeg = #cur - 1
  if remDeg == 1 then
    sols[#sols+1] = -cur[2]/cur[1]
  elseif remDeg == 2 then
    local qs = solveQuadratic(cur[1], cur[2], cur[3])
    for i = 1, len(qs) do sols[#sols+1] = qs[i] end
  elseif remDeg >= 3 then
    return nil -- no closed form attempted for an irreducible cubic+ residual
  end
  if #sols == 0 then return nil end
  return Apply(Set, List(unpack(sols)))
end

Rule(Solve(expr_, x_Symbol),
function(expr, x)
  local A = coeffArray(expr, x)
  if A == nil then return nil end
  local deg = #A - 1
  if deg == 0 then
    if equal(A[1], Int(0)) then return nil end -- 0==0: identically true, no clean way to say "all x"
    return Set()
  elseif deg == 1 then
    return Set(-A[2]/A[1])
  elseif deg == 2 then
    return solveQuadratic(A[1], A[2], A[3])
  else
    return solveHigherDegree(A, x)
  end
end)

local TeXP = Symbol("TeXP")

Rule(TeXP(Plus(c__)),
function(c)
  return Cat('\\left(', TeX(Plus(c)), '\\right)')
end)

Rule(TeXP(a_),
function(a) return TeX(a) end)

Rule(TeX(Times(p_Rat, a_Symbol)),
function(p, a)
  if p[1] < 0 then
    local s = (TeX(Times(-p[1], a)))[1]
    return Str('-\\frac{'..s..'}{'..p[2]..'}')
  else
    local s = (TeX(Times(p[1], a)))[1]
    return Str('\\frac{'..s..'}{'..p[2]..'}')
  end
end)

guacyra.tex = function(e)
  return TeX(e)[1]
end

Rule(TeX(Times(a_Rat, Power(b_Int, p_Rat))),
function(a, b, p)
  if p[1] == 1 and p[2] == 2 then
    local r = TeX(Power(b, p))[1]
    if a[1] <0 then
      if a[1]~= -1 then r = (-a[1])..r end
      r = '-\\frac{'..r..'}{'..a[2]..'}'
    else
      if a[1] ~= 1 then r = a[1]..r end
      r = '\\frac{'..r..'}{'..a[2]..'}'
    end
    return Str(r)
  end
  return nil
end)

Rule(TeX(p_Rat),
function(p)
  local a, b = p[1], p[2]
  if a<0 then
    return Str('-\\frac{'..(-a)..'}{'..b..'}')
  else
    return Str('\\frac{'..(a)..'}{'..b..'}')
  end
end)

Rule(TeX(a_Int),
function(a)
  return Str(''..(a[1]))
end)

Rule(TeX(Times(-1,a__)),
function(a)
  return Cat('-', TeXP(Times(a)))
end)

Rule(TeX(Times(a__)),
function(a)
  local l = NumDen(Times(a))
  if rawequal(l[2][0], Int) then
    return Apply(Cat,Map(TeXP,List(a)))
  else
    local num = TeX(l[1])
    local den = TeX(l[2])
    return Cat('\\frac{',num,'}{',den,'}')
  end
end)

Rule(TeX(Power(a_,b_Rat)),
function(a, b)
  if b[1] == 1 then
    if b[2] == 2 then
      return Cat('\\sqrt{', TeX(a), '}')
    else
      return Cat('\\sqrt['..b[2]..']{',TeX(a),'}')
    end
  else
    return Cat(TeXP(a),'^{', TeX(b), '}')
  end
end)

Rule(TeX(Power(a_, b_Int)),
function(a, b)
  if b[1]<0 then
    return Cat('\\frac{1}{',TeX(Power(a,-b[1])),'}')
  else
    b = ''..b[1]
    if len(b)>1 then
      return Cat(TeXP(a), '^{'..b..'}')
    else
      return Cat(TeXP(a), '^'..b)
    end
  end
end)

Rule(TeX(Power(a_Symbol, b_)),
function(a, b)
  return Cat(a[1] .. '^{', TeX(b),'}')
end)

Rule(TeX(Power(a_, b_)),
function(a, b)
    return Cat(TeXP(a), '^{', TeX(b),'}')
end)

local defaultVars =
  List('x_1','x_2','x_3','x_4','x_5',
       'x_6','x_7','x_8','x_9','x_{10}')

Rule(TeX(Mono(c_NumericQ, l_Tuple)),
function(c, l)
  local s
  local vars = Poly.vars or defaultVars
  local p = Mono(c, l)
  if equal(p[1], Int(1)) then
    if deg(p)==0 then return Str('1') end
    s = ''
  elseif equal(p[1], Int(-1)) then
    if deg(p)==0 then return Str('-1') end
    s = '-'
  else
    s = TeX(p[1])[1]
  end
  local l = p[2]
  for i=1,len(l) do
    local ll = l[i]
    if ll[1]==1 then
      s = s..vars[i][1]
    elseif ll[1]>1 then
      local ls = ''..ll[1]
      if len(ls)==1 then
        s = s..vars[i][1]..'^'..ls       
      else
        s = s..vars[i][1]..'^{'..ls..'}'
      end
    end
  end
  return Str(s)
end, Mono)

Rule(TeX(Poly()),
function()
  return Str('0')
end)

Rule(TeX(Poly(m__Mono)),
function(m)
  local s = ''
  for i=1,len(m) do
    local t = TeX(m[i])
    if t[1]:sub(1,1)~='-' and i~=1 then
      s = s..'+'
    end
    s = s..t[1]
  end
  return Str(s)
end, Poly)

Rule(TeX(Sum(c__)),
function(c)
  local s = ''
  for i=1,len(c) do
    local t = TeX(c[i])
    if t[1]:sub(1,1)~='-' and i~=1 then
      s = s..'+'
    end
    s = s..t[1]
  end
  return Str(s)
end)

Rule(TeX(Dec(n_RatQ)),
function (n)
  return Str(#n.."")
end, Dec)

Rule(TeX(Dec(n_RatQ, m_Int)),
function (n, m)
  if #m>=0 then
    return Str(string.format('%.'..(#m)..'f', #n))
  end
  return nil 
end, Dec)

Rule(TeX(Plus(c__)),
function(c)
  local vars = {}
  local pp = Plus(c)
  if isExpandedPolynomial(pp, vars) then
    local p, s = expToPoly(pp, vars)
    local v = Poly.vars
    Poly.vars = s
    local r = TeX(p)
    Poly.vars = v
    return r
  end
  local s = ''
  for i=1,len(c) do
    local t = TeX(c[i])
    if t[1]:sub(1,1)~='-' and i~=1 then
      s = s..'+'
    end
    s = s..t[1]
  end
  return Str(s)
end)

local function fmtseq(a, del)
  local s=''
  del = del or ','
  for i=1,len(a) do
    if i~=1 then
      s = s..del
    end
    s = s..(TeX(a[i])[1])
  end
  return s
end

Rule(TeX(Set(a__)),
function(a)
  local s='\\left\\{'..fmtseq(a)..'\\right\\}'
  return Str(s)
end)

Rule(TeX(List(a__)),
function(a)
  local s='\\left['..fmtseq(a)..'\\right]'
  return Str(s)
end)

Rule(TeX(Tuple(a__)),
function(a)
  local s='\\left('..fmtseq(a)..'\\right)'
  return Str(s)
end
,Tuple)

Rule(TeX(s_Symbol),
function(s)
  return Str(s[1])
end)

Rule(TeX(s_Str),
function(s)
  return s
end)

Rule(TeX(f_(a___)),
function(f, a)
  return Cat(TeX(f),'\\left('..fmtseq(a)..'\\right)')
end)

Rule(TeX(a_),
function(a)
  return Str(a:tostring())
end)

Rule(Exp(0),
function() return Int(1) end)

Rule(Log(1),
function() return Int(0) end)

Rule(Log(Exp(x_)),
function(x) return x end)

Rule(Exp(Log(x_)),
function(x) return x end)

Rule(Sin(0),
function() return Int(0) end)

Rule(Sin(Pi),
function() return Int(0) end)

Rule(Sin(Times(n_Int, Pi)),
function(n) return Int(0) end)

Rule(Sin(Times(p_Rat, Pi)),
function(p)
  local a, b = p[1], p[2]
  if a < 0 then
    return -Sin((-a)*Pi/b)
  elseif a/b > 2 then
    return Sin((a%(2*b))*Pi/b)
  elseif a/b > 1 then
    return -Sin((a-b)*Pi/b)
  elseif a/b > 0.5 then
    return Sin((b - a)*Pi/b)
  elseif a == 1 and b == 2 then
    return Int(1)
  elseif a == 1 and b == 3 then
    return Sqrt(3)/2
  elseif a == 1 and b == 4 then
    return Sqrt(2)/2
  elseif a == 1 and b == 6 then
    return Rat(1, 2)
  else
    return nil
  end
end)

Rule(Cos(0),
function() return Int(1) end)

Rule(Cos(Pi),
function() return Int(-1) end)

Rule(Cos(Times(n_Int, Pi)),
function(n) return (-1)^n end)

Rule(Cos(Times(p_Rat, Pi)),
function(p)
  local a, b = p[1], p[2]
  if a < 0 then
    return Cos((-a)*Pi/b)
  elseif a/b > 2 then
    return Cos((a%(2*b))*Pi/b)
  elseif a/b > 1 then
    return -Cos((a-b)*Pi/b)
  elseif a/b > 0.5 then
    return -Cos((b - a)*Pi/b)
  elseif a == 1 and b == 2 then
    return Int(0)
  elseif a == 1 and b == 3 then
    return Rat(1, 2)
  elseif a == 1 and b == 4 then
    return Sqrt(2)/2
  elseif a == 1 and b == 6 then
    return Sqrt(3)/2
  else
    return nil
  end
end)

Rule(Tan(0),
function() return Int(0) end)

Rule(Tan(Pi),
function() return Int(0) end)

Rule(Tan(Times(n_Int, Pi)),
function(n) return Int(0) end)

Rule(Tan(Times(p_Rat, Pi)),
function(p)
  local s, c = Sin(p*Pi), Cos(p*Pi)
  if rawequal(s[0], Sin) or rawequal(c[0], Cos) or equal(c, Int(0)) then
    return nil
  end
  return s/c
end)

-- Cot/Csc are undefined at integer multiples of Pi (division by Sin=0),
-- so deliberately no rule is given for Times(n_Int,Pi): they stay symbolic.
Rule(Cot(Times(p_Rat, Pi)),
function(p)
  local s, c = Sin(p*Pi), Cos(p*Pi)
  if rawequal(s[0], Sin) or rawequal(c[0], Cos) or equal(s, Int(0)) then
    return nil
  end
  return c/s
end)

Rule(Sec(0),
function() return Int(1) end)

Rule(Sec(Pi),
function() return Int(-1) end)

Rule(Sec(Times(n_Int, Pi)),
function(n) return (-1)^n end)

Rule(Sec(Times(p_Rat, Pi)),
function(p)
  local c = Cos(p*Pi)
  if rawequal(c[0], Cos) or equal(c, Int(0)) then
    return nil
  end
  return 1/c
end)

Rule(Csc(Times(p_Rat, Pi)),
function(p)
  local s = Sin(p*Pi)
  if rawequal(s[0], Sin) or equal(s, Int(0)) then
    return nil
  end
  return 1/s
end)

Rule(ArcSin(0),
function() return Int(0) end)

Rule(ArcSin(1),
function() return Pi/2 end)

Rule(ArcSin(-1),
function() return -Pi/2 end)

Rule(ArcSin(Rat(1, 2)),
function() return Pi/6 end)

Rule(ArcSin(Rat(-1, 2)),
function() return -Pi/6 end)

Rule(ArcSin(Sqrt(2)/2),
function() return Pi/4 end)

Rule(ArcSin(-Sqrt(2)/2),
function() return -Pi/4 end)

Rule(ArcSin(Sqrt(3)/2),
function() return Pi/3 end)

Rule(ArcSin(-Sqrt(3)/2),
function() return -Pi/3 end)

Rule(ArcCos(0),
function() return Pi/2 end)

Rule(ArcCos(1),
function() return Int(0) end)

Rule(ArcCos(-1),
function() return Pi end)

Rule(ArcCos(Rat(1, 2)),
function() return Pi/3 end)

Rule(ArcCos(Rat(-1, 2)),
function() return 2*Pi/3 end)

Rule(ArcCos(Sqrt(2)/2),
function() return Pi/4 end)

Rule(ArcCos(-Sqrt(2)/2),
function() return 3*Pi/4 end)

Rule(ArcCos(Sqrt(3)/2),
function() return Pi/6 end)

Rule(ArcCos(-Sqrt(3)/2),
function() return 5*Pi/6 end)

Rule(ArcTan(0),
function() return Int(0) end)

Rule(ArcTan(1),
function() return Pi/4 end)

Rule(ArcTan(-1),
function() return -Pi/4 end)

Rule(ArcTan(Sqrt(3)),
function() return Pi/3 end)

Rule(ArcTan(-Sqrt(3)),
function() return -Pi/3 end)

Rule(ArcTan(Sqrt(3)/3),
function() return Pi/6 end)

Rule(ArcTan(-Sqrt(3)/3),
function() return -Pi/6 end)

Rule(Diff(k_, x_Symbol),
function(k, x)
  if not has(k, x) then return Int(0) end
  return nil
end)

Rule(Diff(x_Symbol, x_Symbol),
function(x) return Int(1) end)

Rule(Diff(Power(x_Symbol, n_Int), x_Symbol),
function(x, n) return n*x^(n-1) end)

Rule(Derivative(Log)(1)(x_),
function(x) return 1/x end)

Rule(Derivative(Exp)(1)(x_),
function(x) return Exp(x) end)

Rule(Derivative(Sin)(1)(x_),
function(x) return Cos(x) end)

Rule(Derivative(Cos)(1)(x_),
function(x) return -Sin(x) end)

Rule(Derivative(Tan)(1)(x_),
function(x) return Sec(x)^2 end)

Rule(Derivative(Cot)(1)(x_),
function(x) return -Csc(x)^2 end)

Rule(Derivative(Sec)(1)(x_),
function(x) return Sec(x)*Tan(x) end)

Rule(Derivative(Csc)(1)(x_),
function(x) return -Csc(x)*Cot(x) end)

Rule(Derivative(ArcSin)(1)(x_),
function(x) return 1/Sqrt(1-x^2) end)

Rule(Derivative(ArcCos)(1)(x_),
function(x) return -1/Sqrt(1-x^2) end)

Rule(Derivative(ArcTan)(1)(x_),
function(x) return 1/(1+x^2) end)

Rule(Diff(Times(k_, a__), x_Symbol),
function(k, a, x)
  if not has(k, x) then
    return k*Diff(Times(a), x)
  else
    return Times(Diff(k, x), a)+k*Diff(Times(a), x)
  end
end)

Rule(Diff(Plus(a__), x_Symbol),
function(a, x)
  return Map(function(t) return Diff(t,x) end, Plus(a))
end)

Rule(Diff(Power(f_, n_RatQ), x_Symbol),
function(f, n, x)
  return Times(n, Power(f, n-1), Diff(f, x))
end)

Rule(Diff(f_(y_), x_Symbol),
function(f, y, x)
  return Times(Derivative(f)(1)(y), Diff(y, x))
end)

Rule(TeX(Pi),
function() return Str('\\pi') end, Pi)

Rule(TeX(Exp(a_)),
function(a)
  return Cat('e^{', TeX(a), '}')
end, Exp)

Rule(TeX(Log(a_)),
function(a)
  return Cat('\\log{', TeX(a), '}')
end, Log)

Rule(TeX(Sin(a_)),
function(a)
  return Cat('\\sin{', TeX(a), '}')
end, Sin)

Rule(TeX(Cos(a_)),
function(a)
  return Cat('\\cos{', TeX(a), '}')
end, Cos)

Rule(TeX(Tan(a_)),
function(a)
  return Cat('\\tan{', TeX(a), '}')
end, Tan)

Rule(TeX(Cot(a_)),
function(a)
  return Cat('\\cot{', TeX(a), '}')
end, Cot)

Rule(TeX(Sec(a_)),
function(a)
  return Cat('\\sec{', TeX(a), '}')
end, Sec)

Rule(TeX(Csc(a_)),
function(a)
  return Cat('\\csc{', TeX(a), '}')
end, Csc)

Rule(TeX(ArcSin(a_)),
function(a)
  return Cat('\\arcsin{', TeX(a), '}')
end, ArcSin)

Rule(TeX(ArcCos(a_)),
function(a)
  return Cat('\\arccos{', TeX(a), '}')
end, ArcCos)

Rule(TeX(ArcTan(a_)),
function(a)
  return Cat('\\arctan{', TeX(a), '}')
end, ArcTan)

Rule(TeX(Derivative(f_)(1)(x_)),
function(f, x)
  return Cat(TeX(f), "{'}\\left(", TeX(x),'\\right)')
end, Derivative)

-- Returns a Lua number for e, or nil if e isn't reducible to one (kept
-- outside the Rule/pattern machinery since it recurses over plain Lua
-- numbers, not guacyra expressions).
local function nval(e)
  if isRational(e) then
    return numericValue(e)
  elseif equal(e, Pi) then
    return math.pi
  elseif rawequal(e[0], Plus) or rawequal(e[0], Times) then
    local isPlus = rawequal(e[0], Plus)
    local r = isPlus and 0 or 1
    for i = 1, len(e) do
      local v = nval(e[i])
      if not v then return nil end
      r = isPlus and (r+v) or (r*v)
    end
    return r
  elseif rawequal(e[0], Power) then
    local b, p = nval(e[1]), nval(e[2])
    if not b or not p then return nil end
    if b < 0 and p ~= floor(p) then return nil end
    return b^p
  elseif rawequal(e[0], Sin) then
    local v = nval(e[1]); return v and math.sin(v)
  elseif rawequal(e[0], Cos) then
    local v = nval(e[1]); return v and math.cos(v)
  elseif rawequal(e[0], Tan) then
    local v = nval(e[1]); return v and math.tan(v)
  elseif rawequal(e[0], Exp) then
    local v = nval(e[1]); return v and math.exp(v)
  elseif rawequal(e[0], Log) then
    local v = nval(e[1]); return (v and v > 0) and math.log(v) or nil
  elseif rawequal(e[0], ArcSin) then
    local v = nval(e[1]); return v and math.asin(v)
  elseif rawequal(e[0], ArcCos) then
    local v = nval(e[1]); return v and math.acos(v)
  elseif rawequal(e[0], ArcTan) then
    local v = nval(e[1]); return v and math.atan(v)
  end
  return nil
end

Rule(N(a_),
function(a)
  if isRational(a) then return a end
  local v = nval(a)
  if v == nil then return nil end
  return conv(v)
end)

-- Integrate: table + linearity, generalized to affine arguments a*x+b via
-- coeffArray (Integrate(f(a*x+b),x) = F(a*x+b)/a). No general substitution
-- or integration by parts: anything outside the table stays unevaluated.
Rule(Integrate(c_, x_Symbol),
function(c, x)
  if not has(c, x) then return c*x end
  return nil
end)

Rule(Integrate(Plus(a__), x_Symbol),
function(a, x)
  return Map(function(t) return Integrate(t, x) end, Plus(a))
end)

Rule(Integrate(Times(k_, a__), x_Symbol),
function(k, a, x)
  if not has(k, x) then
    return k*Integrate(Times(a), x)
  end
  return nil
end)

Rule(Integrate(x_Symbol, x_Symbol),
function(x) return x^2/2 end)

Rule(Integrate(Power(x_Symbol, n_Int), x_Symbol),
function(x, n)
  if n[1] == -1 then return Log(x) end
  return x^(n+1)/(n+1)
end)

Rule(Integrate(Power(x_Symbol, n_Rat), x_Symbol),
function(x, n) return x^(n+1)/(n+1) end)

Rule(Integrate(Sin(x_Symbol), x_Symbol),
function(x) return -Cos(x) end)

Rule(Integrate(Cos(x_Symbol), x_Symbol),
function(x) return Sin(x) end)

Rule(Integrate(Exp(x_Symbol), x_Symbol),
function(x) return Exp(x) end)

-- returns (a,b) with u = a*x+b (a,b free of x), or nil if u isn't affine in
-- x -- used to generalize the table above to Integrate(f(a*x+b),x). u==x
-- (a=1,b=0) is intentionally allowed through: table entries that also have
-- a direct x_Symbol rule win by registration order regardless, and entries
-- with no direct counterpart (Sec(u_)^2, the ArcTan form) need this case.
local function affineOf(u, x)
  if not has(u, x) then return nil end
  local A = coeffArray(u, x)
  if A == nil or #A ~= 2 then return nil end
  return A[1], A[2]
end

Rule(Integrate(Sin(u_), x_Symbol),
function(u, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return -Cos(u)/a
end)

Rule(Integrate(Cos(u_), x_Symbol),
function(u, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return Sin(u)/a
end)

Rule(Integrate(Exp(u_), x_Symbol),
function(u, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return Exp(u)/a
end)

Rule(Integrate(Power(Sec(u_), 2), x_Symbol),
function(u, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return Tan(u)/a
end)

Rule(Integrate(Power(Plus(1, Power(u_, 2)), -1), x_Symbol),
function(u, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return ArcTan(u)/a
end)

-- 1/(1+c*u^2): (2*x)^2 etc. auto-distributes to 4*x^2 (Power(Times(a__),b_)
-- above), so the coefficient-free rule alone would miss it; c<=0 has a log-
-- form antiderivative instead of arctan and is deliberately left uncovered.
Rule(Integrate(Power(Plus(1, Times(c_RatQ, Power(u_, 2))), -1), x_Symbol),
function(c, u, x)
  local a = affineOf(u, x)
  if not a or not (numericValue(c) > 0) then return nil end
  local sc = Sqrt(c)
  return ArcTan(sc*u)/(a*sc)
end)

Rule(Integrate(Power(u_, n_Int), x_Symbol),
function(u, n, x)
  local a = affineOf(u, x)
  if not a then return nil end
  if n[1] == -1 then return Log(u)/a end
  return Power(u, n+1)/(a*(n+1))
end)

Rule(Integrate(Power(u_, n_Rat), x_Symbol),
function(u, n, x)
  local a = affineOf(u, x)
  if not a then return nil end
  return Power(u, n+1)/(a*(n+1))
end)

-- Limit: direct substitution when the denominator doesn't vanish, otherwise
-- L'Hopital (bounded depth) on genuine 0/0 forms; anything else (nonzero/0,
-- or an indeterminate form L'Hopital doesn't resolve within the bound)
-- deliberately stays unevaluated rather than guessing at an Infinity value
-- the library has no representation for.
local function limitAt(e, x, a, depth)
  local nd = NumDen(e)
  local sub = {[x[1]] = a}
  local numAtA = eval(nd[1]:subst(sub), true)
  local denAtA = eval(nd[2]:subst(sub), true)
  if not (rawequal(denAtA[0], Int) and denAtA[1] == 0) then
    return numAtA/denAtA
  end
  if rawequal(numAtA[0], Int) and numAtA[1] == 0 then
    if depth <= 0 then return nil end
    return limitAt(Diff(nd[1], x)/Diff(nd[2], x), x, a, depth-1)
  end
  return nil
end

Rule(Limit(e_, x_Symbol, a_),
function(e, x, a)
  return limitAt(e, x, a, 12)
end)

-- Series: plain Taylor polynomial of degree n around x=a (no explicit O()
-- remainder term), built by repeated Diff + evaluation at the point.
Rule(Series(f_, x_Symbol, a_, n_Int),
function(f, x, a, n)
  local term = f
  local fact = Int(1)
  local sub = {[x[1]] = a}
  local result = eval(term:subst(sub), true)
  for k = 1, n[1] do
    term = Diff(term, x)
    fact = fact * k
    local coeff = eval(term:subst(sub), true) / fact
    result = result + coeff*(x-a)^k
  end
  return result
end)

Rule(Numeric(Zm(a_Int, p_Int)),
function(a, p)
  return True
end, Zm)

Rule(Zm(0,p_Int),
function(p) return Int(0) end)

Rule(Zm(a_Int, p_Int),
function(a, p)
  if a[1]>=0 and a[1]<p[1] then
    return nil
  else
    return cat(Zm, a[1] % p[1], p)
  end
end)

Rule(Plus(a_Int, Zm(b_Int, p_Int)),
function(a, b, p)
  return Zm((a[1]+b[1])%p[1], p)
end, Zm)

Rule(Plus(Zm(a_Int, p_Int), Zm(b_Int, p_Int)),
function(a, p, b)
  return Zm((a[1]+b[1])%p[1], p)
end, Zm)

Rule(Times(a_Int, Zm(b_Int, p_Int)),
function(a, b, p)
  return Zm((a[1]*b[1])%p[1], p)
end, Zm)

Rule(Times(Zm(a_Int, p_Int), Zm(b_Int, p_Int)),
function(a, p, b)
  return Zm((a[1]*b[1])%p[1], p)
end, Zm)

Rule(Power(z_Zm, n_Int),
function(z, n)
  local p = z[2][1]
  local r = fmodpow(z[1][1], abs(n[1]), p)
  if n[1]<0 then
    r = invmodp(r, p)
  end
  return Zm(r, p)
end, Zm)

Rule(TeX(Zm(a_Int, p_Int)),
function(a, p)
  return Cat('[',TeX(a),']_{',p,'}')
end, Zm)

Rule(Numeric(Complex(a_,b_)),
function(a, b)
  return Bool(isRational(a) and isRational(b))
end, Complex)

I = Complex(0, 1)

Rule(Complex(a_, 0),
function(a)
  return a
end)

Rule(Conj(Complex(a_, b_)),
function(a, b)
  return Complex(a, -b)
end)

Rule(Abs(a_Int),
function(a)
  return Int(abs(a[1]))
end)

Rule(Abs(a_Rat),
function(a)
  return Rat(abs(a[1]), a[2])
end)

Rule(Abs(Complex(a_, b_)),
function(a, b)
  return Sqrt(a^2+b^2)
end)

Rule(Plus(Complex(a_, b_),
          Complex(c_, d_)),
function(a, b, c, d)
  return Complex(a+c, b+d)
end, Complex)

Rule(Plus(a_,
          Complex(c_, d_)),
function(a, c, d)
  return Complex(a+c, d)
end, Complex)

Rule(Plus(Complex(c_, d_),
          a_),
function(c, d, a)
  return Complex(a+c, d)
end, Complex)

Rule(Times(Complex(a_, b_),
           Complex(c_, d_)),
function(a, b, c, d)
  return Complex(a*c-b*d, a*d+b*c)
end, Complex)

Rule(Times(a_,
          Complex(c_, d_)),
function(a, c, d)
  return Complex(a*c, a*d)
end, Complex)

Rule(Times(Complex(c_, d_),
           a_ ),
function(c, d, a)
  return Complex(a*c, a*d)
end, Complex)

Rule(Power(z_Complex, n_Int),
function(z, n)
  local r = Int(1)
  for i=1,abs(n[1]) do
    r = r*z
  end
  if n[1]<0 then
    return Conj(r)/Power(Abs(r), 2)
  end
  return r
end, Complex)

Rule(TeX(Complex(a_,b_)),
function(a, b)
  local i = Symbols('\\mathrm{i}')
  local b = TeX(b*i)
  if a:eq(0) then
    return b
  end
  if b[1]:sub(1,1)=='-' then
    return Cat(TeX(a),b)
  else
    return Cat(TeX(a),'+',b)
  end
end, Complex)

Rule(Matrix({a_}),
function(a)
  return a
end)

Rule(Matrix(m_Int, n_Int, f_Fun),
function(m, n, f)
  local rs = List()
  for i=1,m[1] do
    local r = List()
    for j=1,n[1] do
      r[j] = f(i, j)
    end
    rs[i] = r
  end
  return Apply(Matrix, rs)
end)

local function dims(m)
  return len(m), len(m[1])
end

Rule(Matrix(s_Str),
function(s)
  s=s[1]:gsub(';%s*', '\r\n')
  local lines = {}
  for ss in s:gmatch("[^\r\n]+") do
    table.insert(lines, ss)
  end
  local m = Matrix()
  for i=1,len(lines) do
    local c = List()
    for ss in lines[i]:gmatch('%S+') do
      local p = ss:find('/')
      local v
      if p then
        v = Rat(tonumber(ss:sub(1,p-1)),tonumber(ss:sub(p+1,-1)))
      else
        v = Int(tonumber(ss))
      end
      c[len(c)+1] = v
    end
    m[len(m)+1] = c
  end
  return m
end)

Rule(Times(a_, A_Matrix),
function(a, A)
  local m, n = dims(A)
  return Matrix(m, n, function(i,j)
    return a*A[i[1]][j[1]]
  end)
end, Matrix)

Rule(Times(A_Matrix, a_),
function(A, a)
  local m, n = dims(A)
  return Matrix(m, n, function(i,j)
    return a*A[i[1]][j[1]]
  end)
end, Matrix)

Rule(Plus(A_Matrix, B_Matrix),
function(A, B)
  local m, n = dims(A)
  return Matrix(m, n, function(i,j)
    return A[i[1]][j[1]]+B[i[1]][j[1]]
  end)
end, Matrix)

Rule(TeX(Matrix(rs__)),
function(rs)
  local t = ''
  local n = len(rs[1])
  for i=1,len(rs) do
    local r = fmtseq(rs[i], ' & ')
    t = t..r..' \\\\'
  end
  local fmt = '{'..string.rep('r', n)..'}'
  return Cat('\\left[\\begin{array}', fmt,
    Str(t),
    '\\end{array}\\right]')
end, Matrix)

Rule(Rand({a_Int, b_Int},
  m_Int, n_Int),
function(a, b, m, n)
  return Matrix(m, n, function(i,j)
    return Int(random(a[1], b[1]))
  end)
end)

Rule(Dot(A_Matrix, B_Matrix),
function(A, B)
  local m, n = dims(A)
  local n2, p = dims(B)
  if n==n2 then
    return Matrix(m, p, function(i,j)
      local c = List()
      for k=1,n do
        c[k] = A[i[1]][k]*B[k][j[1]]
      end
      return Apply(Plus, c)
    end)
  else
    return nil
  end
end)

guacyra.__concat = Dot
Dot.flat = true

Rule(Dot(As__Matrix),
function(As)
  if len(As)==2 then
    return nil
  end
  return Reduce(Dot, List(As))
end)

local function detBird(A)
  local n,Y,X,y,yl,x=len(A),{},{}
  for i=1,n do x={} for j=1,n do x[len(x)+1]=A[i][j] end
Y[len(Y)+1],X[len(X)+1]={},x end
  for l=1,n-1 do
  yl=Int(0)
  for i=1,n do for j=1,n do Y[i][j]=Int(0) end end
  for i=n-l+1,1,-1 do for j=n,i,-1 do 
  y = j>i and -X[i][j] or (i==n and Int(0) or yl+X[i+1][i+1])
  yl = i==j and y or yl
  for k=1,n do Y[i][k]=Y[i][k]+y*A[j][k] end
  end end
  Y,X=X,Y
  end
  return X[1][1]
end

local function det(A)
  local m, n = dims(A)
  if m~=n then
    return nil
  end
  if n==2 then
    return (A[1][1]*A[2][2]-A[1][2]*A[2][1])
  elseif n==3 then
    return (A[1][1]*A[2][2]*A[3][3]+
      A[1][2]*A[2][3]*A[3][1]+
      A[1][3]*A[2][1]*A[3][2]-
      A[1][3]*A[2][2]*A[3][1]-
      A[1][2]*A[2][1]*A[3][3]-
      A[1][1]*A[2][3]*A[3][2])
  elseif n==4 then
    return (
    A[1][1]*A[2][2]*A[3][3]*A[4][4]+
    A[1][1]*A[2][3]*A[3][4]*A[4][2]+
    A[1][1]*A[2][4]*A[3][2]*A[4][3]+
    A[1][2]*A[2][1]*A[3][4]*A[4][3]+
    A[1][2]*A[2][3]*A[3][1]*A[4][4]+
    A[1][2]*A[2][4]*A[3][3]*A[4][1]+
    A[1][3]*A[2][1]*A[3][2]*A[4][4]+
    A[1][3]*A[2][2]*A[3][4]*A[4][1]+
    A[1][3]*A[2][4]*A[3][1]*A[4][2]+
    A[1][4]*A[2][1]*A[3][3]*A[4][2]+
    A[1][4]*A[2][2]*A[3][1]*A[4][3]+
    A[1][4]*A[2][3]*A[3][2]*A[4][1]-
    A[1][1]*A[2][2]*A[3][4]*A[4][3]-
    A[1][1]*A[2][3]*A[3][2]*A[4][4]-
    A[1][1]*A[2][4]*A[3][3]*A[4][2]-
    A[1][2]*A[2][1]*A[3][3]*A[4][4]-
    A[1][2]*A[2][3]*A[3][4]*A[4][1]-
    A[1][2]*A[2][4]*A[3][1]*A[4][3]-
    A[1][3]*A[2][1]*A[3][4]*A[4][2]-
    A[1][3]*A[2][2]*A[3][1]*A[4][4]-
    A[1][3]*A[2][4]*A[3][2]*A[4][1]-
    A[1][4]*A[2][1]*A[3][2]*A[4][3]-
    A[1][4]*A[2][2]*A[3][3]*A[4][1]-
    A[1][4]*A[2][3]*A[3][1]*A[4][2])
  end
  return detBird(A)
end

Rule(Det(A_Matrix), det)

local function rref(A)
  local m, n = dims(A)
  local ii = 1
  for j=1,n do
    local i = ii
    while i<=m and equal(A[i][j], Int(0)) do
      i = i+1
    end
    if i <= m then
      if not Numeric(A[i][j]):test() then
        return
      end
      if i ~= ii then
        A[i], A[ii] = A[ii], A[i]
      end
      local k = (1/A[ii][j])
      if not equal(k, Int(1)) then
        A[ii][j] = Int(1)
        for jj = j+1,n do
          A[ii][jj] = k*A[ii][jj]
        end
      end
      for i=ii-1,1,-1 do
        local k = Times(-1, A[i][j]/A[ii][j])
        if not equal(k, Int(0)) then
          A[i][j] = Int(0)
          for jj=j+1,n do
            A[i][jj] = Expand(A[i][jj]+k*A[ii][jj])
          end
        end
      end
      for i=ii+1,m do
        local k = Times(-1, A[i][j]/A[ii][j])
        if not equal(k, Int(0)) then
          A[i][j] = Int(0)
          for jj=j+1,n do
            A[i][jj] = Expand(A[i][jj]+k*A[ii][jj])
          end
        end
      end
      if ii == m then
        ii = m+1
        break
      end
      ii = ii + 1
    end
  end
  return ii-1
end

Rule(RREF(A_Matrix),
function(A)
  local B = copy(A)
  rref(B)
  return B
end)

Rule(Rank(A_Matrix),
function(A)
  local B = copy(A)
  return Int(rref(B))
end)

Rule(Matrix(m_Int, n_Int, k_RatQ),
function(m, n, k)
  return Matrix(m, n,
    function(i,j)
      if i:eq(j) then
        return k
      else
        return Int(0)
      end
    end)
end)

Rule(Power(A_Matrix, e_Int),
function(A, e)
  local m, n = dims(A)
  local C = Matrix(n, n, 1)
  for i=1,e[1] do
    C = Dot(C, A)
  end
  return C
end, Matrix)

Rule(Diag(List(d__)),
function(d)
  return Matrix(len(d), len(d),
    function(i,j)
      if i:eq(j) then
        return d[i[1]]
      else
        return Int(0)
      end
    end)
end) 

Rule(Diag(A_Matrix),
function(A)
  local l = List()
  local m, n = dims(A)
  n = min(m, n)
  for i=1,n do l[len(l)+1] = A[i][i] end
  return l
end) 

Rule(Tr(A_Matrix),
function(A)
  local r = Int(0)
  local m, n = dims(A)
  n = min(m, n)
  for i=1,n do r = r+A[i][i] end
  return r
end) 

Rule(Inv(A_Matrix),
function(A)
  local m, n = dims(A)
  if n~=m then
    return nil
  end
  -- rank of A alone: rref on the augmented [A|I] block can't be used for
  -- this check, since pivots can be found in the appended identity columns
  -- even when A itself is rank-deficient, masking a singular A.
  if rref(copy(A)) < n then
    return nil
  end
  local AI = Block({A, Matrix(n, n, 1)})
  AI = RREF(AI)
  return Sub(AI,{1,n},{n+1,2*n})
end)

-- LinearSolve(A,b): unique-solution case only (square A, consistent, full
-- column rank) -- rank is computed the same way the Inv fix above does,
-- since RREF on the augmented [A|b] can likewise "borrow" a pivot from b
-- and mask a rank-deficient A. Underdetermined/inconsistent systems are
-- left unevaluated rather than guessing at a parametrized family of
-- solutions this doesn't attempt to represent.
Rule(LinearSolve(A_Matrix, b_List),
function(A, b)
  local m, n = dims(A)
  if len(b) ~= m or rref(copy(A)) < n then
    return nil
  end
  local bmat = Matrix(m, 1, function(i, j) return b[i[1]] end)
  local Ab = RREF(Block({A, bmat}))
  local sol = List()
  for i = 1, n do
    sol[i] = Ab[i][n+1]
  end
  return sol
end)

Rule(CharPoly(A_Matrix, x_Symbol),
function(A, x)
  local m, n = dims(A)
  if m ~= n then return nil end
  return Expand(Det(A - x*Matrix(n, n, 1)))
end)

Rule(Eigenvalues(A_Matrix, x_Symbol),
function(A, x)
  return Solve(CharPoly(A, x), x)
end)

Rule(Sub(a_Matrix,
  List(i1_Int, i2_Int),
  List(j1_Int, j2_Int)),
function (a, i1, i2, j1, j2)
  local r = Matrix()
  for i=i1[1],i2[1] do
    local l = List()
    for j=j1[1],j2[1] do
      l[len(l)+1] = a[i][j]
    end
    r[len(r)+1] = l
  end
  return r
end)

Rule(Sub(a_Matrix,
  List(i1_Int,i2_Int),
  j1_Int),
function (a, i1, i2, j1)
  return Sub(a,{i1,i2},{j1,j1})
end)

Rule(Sub(a_Matrix,
  i1_Int,
  List(j1_Int, j2_Int)),
function (a, i1, j1, j2)
  return Sub(a,{i1,i1},{j1,j2})
end)

local function nGS(B)
  local m, n = dims(B)
  local R = {}
  local mu = {}
  for i=1,m do
    local r = {}
    for j=1,n do r[len(r)+1] = 0 end
    mu[len(mu)+1] = r
  end
  for i=1,m do
    local bi = {}
    local br = {}
    for k=1,n do
      bi[len(bi)+1] = numericValue(B[i][k])
      br[k] = bi[k]
    end
    for j=1,i-1 do
      local bj = {}
      for k=1,n do bj[len(bj)+1] = R[j][k] end
      local m = 0
      for k=1,n do m = m + bi[k]*bj[k] end
      mu[i][j] = m/mu[j][j]
      m = mu[i][j]
      for k=1,n do br[k] = br[k]-m*bj[k] end
    end
    local m = 0
    for k=1,n do m = m + br[k]*br[k] end
    mu[i][i] = m
    R[len(R)+1] = br
  end
  return R, mu
end

local function gramSchmidt(B)
  local m, n = dims(B)
  local R = Matrix()
  local mu = Matrix(m,n,0)
  for i=1,m do
    local bi = Sub(B,i,{1,n})
    local br = copy(bi)
    for j=1,i-1 do
      local bj = Sub(R,j,{1,n})
      mu[i][j] = (bi..Trans(bj))/mu[j][j]
      br = br - mu[i][j]*bj
    end
    mu[i][i] = br..Trans(br)
    R[len(R)+1] = br[1]
  end
  return R, mu
end

Rule(GramSchmidt(B_Matrix),
function(B)
  local R = gramSchmidt(B)
  return R
end)

Rule(LLL(B_Matrix),
function(B)
  B = copy(B)
  local Bs, mu = nGS(B)
  local k = 2
  while k<= len(Bs) do
    for j=k-1,1,-1 do
      local m = mu[k][j]
      if abs(m)>0.5 then
        B[k] = (Matrix(B[k])-floor(m+0.5)*Matrix(B[j]))[1]
        Bs, mu = nGS(B)
      end
    end
    local l = mu[k][k]-(0.75-mu[k][k-1]^2)*mu[k-1][k-1]
    if l>=0 then
      k = k+1
    else
      B[k], B[k-1] = B[k-1], B[k]
      Bs, mu = nGS(B)
      k = max(k-1, 2)
    end
  end
  return B
end)

Rule(Tuple(a_Matrix),
function (a)
  local m, n = dims(a)
  local l = Tuple()
  for i=1,m do
    for j=1,n do
      l[len(l)+1] = a[i][j]
    end
  end
  return l
end)

Rule(Matrix(m_Int, n_Int, t_Tuple),
function(m, n, t)
  if len(t)==(#m*#n) then
    return Matrix(m, n,
    function(i, j)
        return t[#n*(#i-1)+(#j-1)+1]
    end)
  else
    return nil
  end
end, Tuple)

Rule(Trans(a_Matrix),
function (a)
  local m, n = dims(a)
  local r = Matrix()
  for j=1,n do
    local l = List()
    for i=1,m do
      l[len(l)+1] = a[i][j]
    end
    r[len(r)+1] = l
  end
  return r
end)

Rule(Block(a__List),
function (a)
  local mb, nb = dims(a)
  local r = Matrix()
  local ir = 1
  for ib=1,mb do
    local m = len(a[ib][1])
    for i = 1,m do
      local l = List()
      for jb=1,nb do
        local mm, n = dims(a[ib][jb])
        for j=1,n do
          l[len(l)+1] = a[ib][jb][i][j]
        end
      end
      r[len(r)+1] = l
    end
  end
  return r
end)


local OutputP = Symbol("OutputP")

Rule(OutputP(Plus(c__)),
function(c)
  return Cat('(', Output(Plus(c)), ')')
end)

Rule(OutputP(a_),
function(a) return Output(a) end)

Rule(Output(Times(p_Rat, a_Symbol)),
function(p, a)
  if p[1] < 0 then
    local s = (Output(Times(-p[1], a)))[1]
    return Str('-'..s..'/'..p[2])
  else
    local s = (Output(Times(p[1], a)))[1]
    return Str(''..s..'/'..p[2])
  end
end)

guacyra.output = function(e)
  return Output(e)[1]
end

Rule(Output(Times(a_Rat, Power(b_Int, p_Rat))),
function(a, b, p)
  if p[1] == 1 and p[2] == 2 then
    local r = Output(Power(b, p))[1]
    if a[1] <0 then
      if a[1]~= -1 then r = (-a[1])..r end
      r = '-'..r..'/'..a[2]
    else
      if a[1] ~= 1 then r = a[1]..r end
      r = ''..r..'/'..a[2]
    end
    return Str(r)
  end
  return nil
end)

Rule(Output(p_Rat),
function(p)
  local a, b = p[1], p[2]
  if a<0 then
    return Str('-'..(-a)..'/'..b)
  else
    return Str(''..(a)..'/'..b)
  end
end)

Rule(Output(a_Int),
function(a)
  return Str(''..(a[1]))
end)

Rule(Output(Times(-1,a__)),
function(a)
  return Cat('-', OutputP(Times(a)))
end)

Rule(Output(Times(a__)),
function(a)
  local l = NumDen(Times(a))
  if rawequal(l[2][0], Int) then
    return Reduce(
      Fun(Cat(_1, '*', _2)),
      Map(OutputP, List(a))
    )
  else
    local num = Output(l[1])
    local den = Output(l[2])
    return Cat('',num,'/',den)
  end
end)

Rule(Output(Power(a_,b_Rat)),
function(a, b)
  return Cat(OutputP(a),'^', OutputP(b))
end)

Rule(Output(Power(a_, b_Int)),
function(a, b)
  if b[1]<0 then
    return Cat('1/',Output(Power(a,-b[1])))
  else
    b = ''..b[1]
    return Cat(OutputP(a), '^'..b)
  end
end)

Rule(Output(Power(a_Symbol, b_)),
function(a, b)
  return Cat(a[1] .. '^', OutputP(b))
end)

Rule(Output(Power(a_, b_)),
function(a, b)
    return Cat(OutputP(a), '^', OutputP(b))
end)

Rule(Output(Plus(a__)),
function(a)
  return Reduce(
    Fun(
      If(Equal(Sub(_2,{1,1}), '-'),
        Cat(_1, _2),
      Cat(_1, '+', _2)
      )
    ), Map(Output, List(a))
  )
end)

Rule(Output(a_),
function(a)
  return Str(a:tostring())
end)


local function texcmd(c, ...)
  local s = '\\'..c
  local a = {...}
  for i=1,#a do
    local t = conv(a[i]):tex()
    s = s..'{'..t..'}'
  end
  tex.sprint(s)
end

_G['Symbols'] = Symbols
_G['Rule'] = Rule
_G['Clear'] = function(...)
local s = {...}
  for i=1,#s do
    guacyra.__symbols[s[i][1]] = nil
  end
end
_G['texcmd'] = texcmd

return guacyra
