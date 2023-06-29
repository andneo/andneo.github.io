// Marching Squares
// Coding in the Cabana
// The Coding Train / Daniel Shiffman
// https://thecodingtrain.com/challenges/coding-in-the-cabana/005-marching-squares.html
// https://youtu.be/0ZONMNUKTfU
// p5 port: https://editor.p5js.org/codingtrain/sketches/g6-zufS8c
p5.disableFriendlyErrors = true;
let field = [];
let rez = 15;
let cols, rows;
let increment = 0.1;
let zoff = 0;
let noise;
let canvas;

// function windowResized() {
//   canvas = createCanvas(windowWidth, 4.5*windowHeight);
//   canvas.position(0,0);
// }


function setup() {
  pixelDensity(1);
    canvas = createCanvas(windowWidth, 4.5*windowHeight); //make it an object
    canvas.position(0,0,'fixed');
    canvas.style('z-index','-1');
  noise = new OpenSimplexNoise(Date.now());
  cols = 1 + width / rez;
  rows = 1 + height / rez;
  for (let i = 0; i < cols; i++) {
    let k = [];
    for (let j = 0; j < rows; j++) {
      k.push(0);
    }
    field.push(k);
  }
}

function drawLine(v1, v2) {
  stroke('#f92672');
  line(v1.x, v1.y, v2.x, v2.y);
}

function draw() {
  // background(0); 
  clear();
  let xoff = 0;
  for (let i = 0; i < cols; i++) {
    xoff += increment;
    let yoff = 0;
    for (let j = 0; j < rows; j++) {
      field[i][j] = float(noise.noise3D(xoff, yoff, zoff));
      yoff += increment;
    }
  }
  zoff += 0.03;

  for (let h = -1; h < 1; h += 1.0) {
    stroke(255 * h, 255 * -h, 127);
    strokeWeight(1.5);
  
    for (let i = 0; i < cols - 1; i++) {
      for (let j = 0; j < rows - 1; j++) {
        let f0 = field[i][j] - h;
        let f1 = field[i + 1][j] - h;
        let f2 = field[i + 1][j + 1] - h;
        let f3 = field[i][j + 1] - h;
  
        let x = i * rez;
        let y = j * rez;
        let a = createVector(x + rez * f0 / (f0 - f1), y);
        let b = createVector(x + rez, y + rez * f1 / (f1 - f2));
        let c = createVector(x + rez * (1 - f2 / (f2 - f3)), y + rez);
        let d = createVector(x, y + rez * (1 - f3 / (f3 - f0)));
  
        let state = getState(f0, f1, f2, f3);
        switch (state) {
          case 1:
            drawLine(c, d);
            break;
          case 2:
            drawLine(b, c);
            break;
          case 3:
            drawLine(b, d);
            break;
          case 4:
            drawLine(a, b);
            break;
          case 5:
            drawLine(a, d);
            drawLine(b, c);
            break;
          case 6:
            drawLine(a, c);
            break;
          case 7:
            drawLine(a, d);
            break;
          case 8:
            drawLine(a, d);
            break;
          case 9:
            drawLine(a, c);
            break;
          case 10:
            drawLine(a, b);
            drawLine(c, d);
            break;
          case 11:
            drawLine(a, b);
            break;
          case 12:
            drawLine(b, d);
            break;
          case 13:
            drawLine(b, c);
            break;
          case 14:
            drawLine(c, d);
            break;
        }
      }
    }
    }
  }
  
  function getState(a, b, c, d) {
    return (a > 0 ? 8 : 0) + (b > 0 ? 4 : 0) + (c > 0 ? 2 : 0) + (d > 0 ? 1 : 0);
  }