---
title: GeoGebra
layout: page
---

[GeoGebra](https://www.geogebra.org/classic) por Exemplo
========================================================

Teorema de Tales
----------------

~~~
A=(1,1)
B=(4,2)
k=Semicírculo(A,B)
C=Ponto(k)
tri=Polígono(A,B,C)
γ=Ângulo(A,C,B)
IniciarAnimação(C)
~~~

Superfície de Revolução
-----------------------

~~~
f(x)=Função(x/2+1, 0, 4)
Superfície(f, 2π)
~~~


Superfície de Revolução + Múltiplas Sentenças
---------------------------------------------

~~~
g(x)=Se(x<0, x/2+2, 2e^(-x))
f(x)=Função(g(x), -2, 2)
Superfície(f, 2π)
~~~


Superfície de Revolução + Controle Deslizante
---------------------------------------------

~~~
g(x)=Se(x<-1, x+3, Se(x>1, -x+3, x^2+1))
f(x)=Função(g(x), -2, 2)
α=ControleDeslizante(0, 2π)
Superfície(f, α)
~~~


Toro
----

~~~
c=Círculo((2,0),1,EixoZ)
Superfície(c, 2π, EixoY)
~~~

Revolução da Lemniscata
-----------------------

~~~
c: r=sqrt(cos(2θ))
Superfície(c, 2π, EixoX)
Superfície(c, π, EixoY)
~~~

Aproximação do Volume
---------------------

~~~
f(x)=e^(-x^2)
Superfície(f, 2π)
dt=ControleDeslizante(0.01, 0.5)
dt=0.2
Sequência(Cilindro((i,0,0),(i+dt,0,0),f(i+dt/2)),i,-2,2,dt)
~~~

Sequência de Cilindros
----------------------

~~~
f(x)=log(x+1)
dt=ControleDeslizante(0.01, 0.5)
dt=0.2
Sequência(Cilindro((i,f(i),0),(i+dt,f(i+dt),0),f(i)/2),i,0,4,dt)
~~~

Curva de Nível
--------------

~~~
f(x,y)=(1-(x^2+y^3))e^(-(x^2+y^2)/2)
k=ControleDeslizante(-1,1)
z=k
(1-(x^2+y^3))e^(-(x^2+y^2)/2)=k
~~~

Superfícies e Curvas Paramétricas
---------------------------------

~~~
s: Superfície(cos(u)(R+r cos(t)), sin(u)(R+r cos(t)),r sin(t), t, 0, 2π, u, 0, 2π)
c: Curva(cos(t)(R+r cos(n t)), sin(t)(R+r cos(n t)),r sin(n t), t, 0, 2π)
~~~

Triedro de Frenet
-----------------

~~~
f(x)=cos(x)
g(x)=sen(x)
h(x)=x
r=Curva(f(t),g(t),h(t),t,-5,5)
t=ControleDeslizante(-5,5)
P=r(t)
u=1/sqrt(2)*(-sen(t),cos(t),1)
T=Vetor(P,P+u)
v=(-cos(t),-sen(t),0)
N=Vetor(P,P+v)
w=u⊗v
B=Vetor(P,P+w)
~~~


Planificação
------------

~~~
t=ControleDeslizante(0,1)
d=Dodecaedro((0,0,0),(1,0,0))
Planificação(d,t)
~~~
