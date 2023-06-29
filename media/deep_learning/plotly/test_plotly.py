import plotly
from plotly.graph_objs import *
import plotly.graph_objects as go
import numpy as np


# f    = lambda x: ((x**4)+(x**2)+(10*x))/50
# g    = lambda x: ((4*x**3)+(2*x)+10)/50
# def f(x): 
#     fv = []
#     for xi in x:
#         p1 = np.max([0,(3*xi-2.3)**3+1])**2
#         p2 = np.max([0,(-3*xi+0.7)**3+1])**2
#         fv.append(p1+p2)
#     return fv

def f(x): 
    zer_x = np.zeros(np.shape(x))
    # print(np.maximum(zer_x,((3*x-2.3)**3+1)**2))
    f_x = np.maximum(zer_x,((2*x-1.)**3+1))**2 + np.maximum(zer_x,((-2*x+1.)**3+1))**2
    return f_x

def g(x):
    fv = []
    for xi in x:
        p1 = np.max([0,(3*xi-2.3)**3+1])**2
        if(p1>0):
            g1 = 9.*(30.*xi-23)**2*((30.*xi-23)**3+1000) / 50000.
        else:
            g1 = 0
        p2 = np.max([0,(-3*xi+0.7)**3+1])**2
        if(p2>0):
            g2 = -9.*(7-30.*xi)**2*((7-30.*xi)**3+1000) / 50000.
        else:
            g2 = 0
        fv.append(g1+g2)
    return fv


trace_list1 = []
trace_list2 = []
trace_list3 = []
trace_list4 = []
trace_list5 = []
trace_list6 = []
xfull = np.arange(-1,2.01,0.1)
yfull = f(xfull)

conv = False
start = 0
xmin = [start]
fmin = [f(start)]
tmin = [g([start])*(xfull-start)+f(start)]
c = 0
while not conv:
    xi = xmin[c]
    gi = g([xi])[0]
    xnew = xi - 0.015*gi
    xmin.append(xnew)
    fmin.append(f(xnew))
    print(2,c,f(xnew), gi)
    tmin.append(g([xnew])*(xfull-xnew)+f(xnew))
    if(abs(gi)<1.e-03):
        conv = True
    c = c + 1

num_steps = len(xmin)
finish = xmin[-1]

num_steps = 1

for i in range(num_steps):
    
    if(i==0):
        vis = True
    else:
        vis = False

    vline_x = []
    if(fmin[i]>0):
        vline_y = np.arange(0,fmin[i],0.01)
    else:
        vline_y = np.arange(fmin[i],0,0.01)

    for j in range(len(vline_y)):
        vline_x.append(xmin[i])

    pltpoints=[]
    pltfnctin=[]
    for j in range(i+1):
        pltpoints.append(xmin[j])
        pltpoints.append(xmin[j])
        pltfnctin.append(0)
        pltfnctin.append(fmin[j])

    trace_list1.append(go.Scatter(x=xfull,y=yfull, visible=vis, line={'color': 'black'}))
    trace_list2.append(go.Scatter(x=xfull,y=tmin[i], visible=vis, line={'color': '#d62728'}))
    trace_list3.append(go.Scatter(x=pltpoints,y=pltfnctin, visible=vis, mode='markers'))
    trace_list4.append(go.Scatter(x=vline_x,y=vline_y, visible=vis, mode='lines', line={'color': '#7f7f7f'}))
    if(i<2):
        text = "Far away from the minimum<br>the gradient is large and so<br> large steps are taken"
    elif(i<14):
        text = "As we approach the minimum<br>the gradient gets smaller and we<br>take smaller steps"
    else:
        text = "In the vicinity of the minimum<br>the gradient gets so small that<br>we make almost no progress<br>at each iteration"
    trace_list5.append(go.Scatter(x=[0],y=[2.5],mode="text",text=[text],textposition="bottom center", visible=vis,textfont=dict(size=16)))
    text = "<i>f(x)</i>=" +str( round(f(xmin[i]),4) )+", <i>g(x)</i>="+str( round(g([xmin[i]])[0],4) )
    trace_list6.append(go.Scatter(x=[2.7],y=[-0.225],mode="text",text=[text],textposition="bottom center", visible=vis,textfont=dict(size=12)))

fig = go.Figure(data=trace_list1+trace_list2+trace_list3+trace_list4+trace_list5+trace_list6)

steps = []
for i in range(num_steps):
    
    step = dict(
        method = 'restyle',  
        args = ['visible', [False] * len(fig.data),
                "Iteration: "],
                label="Iteration: " + str(i)
    )
    
    # Enable the two traces we want to see
    step['args'][1][i] = True           # Add figure from list 1
    step['args'][1][i+num_steps] = True # Add figure from list 2
    step['args'][1][i+2*num_steps] = True
    step['args'][1][i+3*num_steps] = True
    step['args'][1][i+4*num_steps] = True
    step['args'][1][i+5*num_steps] = True
    
    # Add step to step list
    steps.append(step)

sliders = [dict(
    # active=0,
    # currentvalue={"prefix": ""},
    steps = steps,
)]

fig.layout.sliders = sliders
fig['layout']['sliders'][0]['pad']=dict(r= 0, t= 50,)
fig['layout']['margin']=dict(t=20)
# fig['layout']['sliders'][0]['steps'] = dict(value="") #or ‘rgb(235,235,235)’


fig.update_layout(
    autosize=True,
    sliders=sliders,
    paper_bgcolor='rgba(0,0,0,0)',
    plot_bgcolor='rgba(0,0,0,0)',
    showlegend=False,
    xaxis_range=[-1,1.],
    yaxis_range=[-0.0,5.],
    xaxis=dict(showgrid=False,mirror=True,ticks='outside',showline=True,zeroline=False,linecolor='slategray'),
    yaxis=dict(showgrid=False,mirror=True,ticks='outside',showline=True,zeroline=True,fixedrange=False,linecolor='slategray'),
    xaxis_title=r"<i>x</i>", yaxis_title=r"<i>f(x)</i>",
    # font_size=24
    font_family="Helvetica"

)

fig.update_xaxes(color='slategray')
fig.update_yaxes(color='slategray')

layout = Layout(
    paper_bgcolor='rgba(0,0,0,0)',
    plot_bgcolor='rgba(0,0,0,0)'
)

# plotly.io.write_json(fig=fig,file='./test_file.json')
fig.show()