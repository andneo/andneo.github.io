import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm

# =========================================================================================================================
# =========================================================================================================================
# =======================  SET UP THE STYLE OF MATPLOTLIB FIGURE TO BE GENERATED ==========================================
# =========================================================================================================================
# =========================================================================================================================
# Define the style of the plot
# A list of default styles is given at https://matplotlib.org/gallery/style_sheets/style_sheets_reference.html
plt.style.use('bmh')
plt.rcParams['axes.unicode_minus'] = False
# Define fonts to be used as standard for the plot
# The Computer Modern roman font (cmr10) is used here to provide a close match to LaTeX text. 
plt.rcParams['mathtext.fontset'] = 'cm'
plt.rcParams['font.family'] = 'cmr10'
plt.rcParams['font.weight'] = 'light'
plt.rcParams['axes.prop_cycle'] = plt.cycler(color=["r", "k", "c"]) 
# Set the width and colour of the border around the plot
plt.rcParams['axes.linewidth'] = 2.5
plt.rc('axes',edgecolor='#777777')

fig = plt.figure(figsize=(15, 6))
# fig.tight_layout(pad=50.0)
# Set up figure environment
ax = fig.add_subplot(122)

# Define the title of the plot and the labels for the x and y axes
# plt.title(r'$\bar{q}$ calculations for strong tetrahedra only with $\epsilon_{AA}=1, \epsilon_{BB}=5$', size=26)
ax.set_xlabel(r'$x_{0}$', size=25, color='#777777')
ax.set_ylabel(r'$x_{1}$', size=25, rotation=90, color='#777777')

max_val = 1.05
# Generate a mesh over which we will evaluate our function to define a contour plot.
xmin, xmax, xstep = 0., max_val, .01
ymin, ymax, ystep = 0., max_val, .01

ax.xaxis.set_ticks(np.arange(xmin, xmax+0.0001, 50.0))
ax.yaxis.set_ticks(np.arange(ymin, ymax+0.0001, 50.0))
# Set the size of the axes parameters (i.e., the x and y values)
plt.tick_params(labelsize=20, color='#777777')
# Add or remove grid lines from the plot
ax.grid(False)

# Set the width of the ticks on the x and y axes
ax.xaxis.set_tick_params(width=2.5, length=5.0, colors='#777777')
ax.yaxis.set_tick_params(width=2.5, length=5.0, colors='#777777')

# Set the facecolour of the plot to white, as it is grey for the bmh style
ax.set_facecolor('xkcd:white')

# Beale Function
def f(x,y): 
    zer_x = np.zeros(np.shape(x))
    zer_y = np.zeros(np.shape(y))
    f_x = np.maximum(zer_x,((3*x-2.3)**3+1))**2 + np.maximum(zer_x,((-3*x+0.7)**3+1))**2
    f_y = np.maximum(zer_y,((3*y-2.3)**3+1))**2 + np.maximum(zer_y,((-3*y+0.7)**3+1))**2
    return f_x + f_y

def g(x,y):
    zer_x = np.zeros(np.shape(x))
    zer_y = np.zeros(np.shape(y))
    f_x1 = np.maximum(zer_x,((3*x-2.3)**3+1))**2
    f_x2 = np.maximum(zer_x,((-3*x+0.7)**3+1))**2
    f_y1 = np.maximum(zer_y,((3*y-2.3)**3+1))**2
    f_y2 = np.maximum(zer_y,((-3*y+0.7)**3+1))**2
    dim1 = np.shape(x)[0]
    dim2 = np.shape(x)[1]
    grad = np.zeros((2,np.shape(x)[0],np.shape(x)[0]))
    for i in range(dim1):
        for j in range(dim2):
            if(f_x1[i][j]>0):
                grad[0][i][j] = grad[0][i][j] + 9.*(30.*x[i][j]-23)**2*((30.*x[i][j]-23)**3+1000) / 50000.
            if(f_x2[i][j]>0):
                grad[0][i][j] = grad[0][i][j] - 9.*(7-30.*x[i][j])**2*((7-30.*x[i][j])**3+1000) / 50000.
            if(f_y1[i][j]>0):
                grad[1][i][j] = grad[1][i][j] + 9.*(30.*y[i][j]-23)**2*((30.*y[i][j]-23)**3+1000) / 50000.
            if(f_y2[i][j]>0):
                grad[1][i][j] = grad[1][i][j] - 9.*(7-30.*y[i][j])**2*((7-30.*y[i][j])**3+1000) / 50000.
    return grad
    # p1 = np.max([0,(3*xi-2.3)**3+1])**2
    # if(p1>0):
    #     g1 = 9.*(30.*xi-23)**2*((30.*xi-23)**3+1000) / 50000.
    # else:
    #     g1 = 0
    # p2 = np.max([0,(-3*xi+0.7)**3+1])**2
    # if(p2>0):
    #     g2 = -9.*(7-30.*xi)**2*((7-30.*xi)**3+1000) / 50000.
    # else:
    #     g2 = 0
    # fv.append(g1+g2)

# x, y = np.meshgrid(np.arange(xmin, xmax + xstep, xstep), np.arange(ymin, ymax + ystep, ystep))         
x,y = np.meshgrid(np.linspace(int(0),int(max_val),500),np.linspace(int(0),int(max_val),500))
z = f(x, y)

# normi = mpl.colors.Normalize(vmin=0, vmax=2.*max_val**2)
cp = ax.contourf(x, y, z, levels=500, cmap='rainbow', alpha=0.8)

# t = [0, 50, 100, 150, 200]
# colbar = plt.colorbar(cp, ticks=t, norm=normi)
# # colbar.set_norm(normi)
# colbar.set_label(r'$f(x_{0},x_{1})$', size=25, color='#777777')
# colbar.outline.set_linewidth(2)
# # colbar.outline.set_color('#777777')
# colbar.ax.tick_params(width=2,labelsize=20, colors='#777777') 

x,y = np.meshgrid(np.linspace(int(0),int(max_val),30),np.linspace(int(0),int(max_val),30))
u, v = g(x,y)
ax.quiver(x,y,u,v, color='black')

ax2 = fig.add_subplot(121,projection='3d')
# ax2 = plt.axes(projection='3d')
ax2.set_xlabel(r'$x_{0}$', size=20, color='#777777')
ax2.set_ylabel(r'$x_{1}$', size=20, color='#777777')
ax2.set_zlabel(r'$f(x_{0},x_{1})$', size=20, color='#777777')

# Generate a mesh over which we will evaluate our function to define a contour plot.
xmin, xmax, xstep = 0., max_val, .01
ymin, ymax, ystep = 0., max_val, .01

# ax2.xaxis.set_ticks(np.arange(xmin, xmax+0.0001, 2.0))
# ax2.yaxis.set_ticks(np.arange(ymin, ymax+0.0001, 2.0))
# ax2.zaxis.set_ticks(np.arange(0, 2*max_val**2+0.01, 50.0))
# Set the size of the axes parameters (i.e., the x and y values)
# plt.tick_params(labelsize=15)
# Add or remove grid lines from the plot
ax2.grid(True)

# Set the width of the ticks on the x and y axes
ax2.xaxis.set_tick_params(width=2.5, length=5.0, colors='#777777')
ax2.yaxis.set_tick_params(width=2.5, length=5.0, colors='#777777')
ax2.zaxis.set_tick_params(width=2.5, length=5.0, colors='#777777')

# Set the facecolour of the plot to white, as it is grey for the bmh style
ax2.set_facecolor('xkcd:white')

x,y = np.meshgrid(np.linspace(int(0),max_val,100),np.linspace(int(0),max_val,100))
z = f(x, y)
ax2.contour3D(x, y, z, 50, cmap='rainbow')
cp = ax2.plot_surface(x, y, z, rstride=1, cstride=1, cmap='rainbow', edgecolor='none',  alpha=0.8)

plt.subplots_adjust(left=0.01,
                    bottom=0.12,
                    right=0.95,
                    top=0.95,
                    wspace=0.4,
                    hspace=0.4)

# plt.savefig('gradient.svg', format='svg', dpi=400,transparent=True)
plt.show()