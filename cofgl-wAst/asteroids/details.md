<!-- pandoc -s --mathjax details.md -o details.html -->

Games in 2-manifolds
====================

Metric
------

$$ds^2=\frac{4(dx^2+dy^2)}{(1+K(x^2+y^2))^2}=\frac{4dz\overline{dz}}{(1+K|z|^2)^2}$$ 

$$\begin{align*}
\text{arctan}_K(z) &=\sum_{n=0}^\infty \frac{K^nz^{2n+1}}{2n+1} \\
  &=\left\{
    \begin{array}{cc}
    \text{arctanh(z)}, & \text{ if }K=-1\\
    \text{z}, & \text{ if }K=0\\
    \text{arctan(z)}, & \text{ if }K=1
    \end{array}
    \right.
\end{align*}$$

$$d(z_1,z_2)=2\text{arctan}_K\left|\frac{z_1-z_2}{1+Kz_1\overline{z_2}}\right|$$

Isometries
---------------------
Translation ($a\rightarrow 0$) 
$$T_a(z)=\frac{z-a}{1+Kz\overline{a}}$$

Rotation 0
$$R_\theta(z)=e^{i\theta}z$$

Reflection 0
$$R(z)=-z$$

Mirror ($a\leftrightarrow0$)
$$M(z)=\frac{a^2}{|a|^2}\frac{\overline{a-z}}{1+Ka\overline{z}}$$

Perpendicular Bisector ($\overline{0a}$)
$$K|a|^2(x^2+y^2)+2a_xx+2a_yy=|a|^2$$

If $K\neq 0$, 
$$\left(x+K\frac{a_x}{|a|^2}\right)^2+
\left(y+K\frac{a_y}{|a|^2}\right)^2=\frac{1}{|a|^2}+K$$

Midpoint ($\overline{0a}$)
$$m=\left\{\begin{array}{cc}
  \frac{1}{2}a, \text{ if }K=0\\
  K\frac{\sqrt{1+K|a|^2}-1}{|a|^2}a
\end{array}\right.$$


Geodesic Circle $(O,R)$
-----------------------

$$p=\text{tan}_K\left(\frac{R}{2}\right)$$

$$\left(x-\frac{O_x(1+Kp^2)}{1-p^2K^2|O|^2}\right)^2+
\left(y-\frac{O_y(1+Kp^2)}{1-p^2K^2|O|^2}\right)^2=
\left(\frac{p(1+K|O|^2)}{1-p^2K^2|O|^2}\right)^2$$

Geodesic Update Rule
--------------------

$$L(q_x,q_y,p_x,p_y)=\frac{4(p_x^2+p_y^2)}{(1+K(q_x^2+q_y^2))^2}$$
$$L_d(q_x,q_y,q_x',q_y',h)=
hL\left(q_x,q_y,\frac{q_x'-q_x}{h},\frac{q_y'-q_y}{h}\right)$$

$$\begin{align*}
p_x &= \frac{8}{h(1+K|q|^2)^2}
\left(\Delta q_x +
2 K q_x\left((\Delta q_x)^2+(\Delta q_y)^2\right) \right) \\
p_y &= \frac{8}{h(1+K|q|^2)^2}
\left(\Delta q_y +
2 K q_y\left((\Delta q_x)^2+(\Delta q_y)^2\right) \right) \\
q_x'&=q_x+\Delta q_x \\
q_y'&=q_y+\Delta q_y \\
p_x'&=\frac{8\Delta q_x}{h(1+K|q|^2)^2}\\
p_y'&=\frac{8\Delta q_y}{h(1+K|q|^2)^2}\\
\end{align*}$$


