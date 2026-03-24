(function () {
  'use strict';

  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  const config = {
    SIM_RESOLUTION: 64,
    DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.82,
    VELOCITY_DISSIPATION: 0.98,
    PRESSURE: 0.5,
    PRESSURE_ITERATIONS: 8,
    CURL: 6,
    SPLAT_RADIUS: 0.035,
    SPLAT_FORCE: 35,
    DT_SCALE: 0.18,
  };

  // Theme colors: purple, cyan, violet, blue
  const PALETTE = [
    { r: 0.25, g: 0.20, b: 1.00 },
    { r: 0.00, g: 0.65, b: 1.00 },
    { r: 0.45, g: 0.10, b: 1.00 },
    { r: 0.10, g: 0.45, b: 0.90 },
  ];
  let colorIndex = 0;

  function nextColor() {
    const c = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
    return { r: c.r * 0.10, g: c.g * 0.10, b: c.b * 0.10 };
  }

  /* ── WebGL setup ── */
  const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext('webgl2', params);
  const isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
  if (!gl) return;

  let halfFloat, supportLinearFiltering;
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float');
    supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float');
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
  }
  gl.clearColor(0, 0, 0, 0);

  const HALF = isWebGL2 ? gl.HALF_FLOAT : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE);
  const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

  function supportedFormat(internalFormat, format) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, HALF, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  let fmtRGBA, fmtRG, fmtR;
  if (isWebGL2) {
    fmtRGBA = supportedFormat(gl.RGBA16F, gl.RGBA) ? { i: gl.RGBA16F, f: gl.RGBA } : { i: gl.RGBA, f: gl.RGBA };
    fmtRG   = supportedFormat(gl.RG16F,   gl.RG)   ? { i: gl.RG16F,   f: gl.RG   } : fmtRGBA;
    fmtR    = supportedFormat(gl.R16F,    gl.RED)   ? { i: gl.R16F,    f: gl.RED  } : fmtRG;
  } else {
    fmtRGBA = fmtRG = fmtR = { i: gl.RGBA, f: gl.RGBA };
  }

  /* ── Shaders ── */
  const VS = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main(){
      vUv = aPosition*0.5+0.5;
      vL = vUv-vec2(texelSize.x,0.0); vR = vUv+vec2(texelSize.x,0.0);
      vT = vUv+vec2(0.0,texelSize.y); vB = vUv-vec2(0.0,texelSize.y);
      gl_Position = vec4(aPosition,0.0,1.0);
    }`;

  const shaders = {
    splat: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main(){
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p,p)/radius)*color;
        gl_FragColor = vec4(texture2D(uTarget,vUv).xyz+splat, 1.0);
      }`,
    advection: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity; uniform sampler2D uSource;
      uniform vec2 texelSize; uniform vec2 dyeTexelSize;
      uniform float dt; uniform float dissipation;
      vec4 bilerp(sampler2D s, vec2 uv, vec2 ts){
        vec2 st=uv/ts-0.5; vec2 i=floor(st); vec2 f=fract(st);
        vec4 a=texture2D(s,(i+vec2(0.5,0.5))*ts);
        vec4 b=texture2D(s,(i+vec2(1.5,0.5))*ts);
        vec4 c=texture2D(s,(i+vec2(0.5,1.5))*ts);
        vec4 d=texture2D(s,(i+vec2(1.5,1.5))*ts);
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
      }
      void main(){
        vec2 coord=vUv-dt*bilerp(uVelocity,vUv,texelSize).xy*texelSize;
        gl_FragColor=bilerp(uSource,coord,dyeTexelSize)/(1.0+dissipation*dt);
      }`,
    divergence: `
      precision highp float;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      void main(){
        float L=texture2D(uVelocity,vL).x, R=texture2D(uVelocity,vR).x;
        float T=texture2D(uVelocity,vT).y, B=texture2D(uVelocity,vB).y;
        vec2 C=texture2D(uVelocity,vUv).xy;
        if(vL.x<0.0)L=-C.x; if(vR.x>1.0)R=-C.x;
        if(vT.y>1.0)T=-C.y; if(vB.y<0.0)B=-C.y;
        gl_FragColor=vec4(0.5*(R-L+T-B),0.0,0.0,1.0);
      }`,
    curl: `
      precision highp float;
      varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uVelocity;
      void main(){
        float L=texture2D(uVelocity,vL).y, R=texture2D(uVelocity,vR).y;
        float T=texture2D(uVelocity,vT).x, B=texture2D(uVelocity,vB).x;
        gl_FragColor=vec4(0.5*(R-L-T+B),0.0,0.0,1.0);
      }`,
    vorticity: `
      precision highp float;
      varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uVelocity; uniform sampler2D uCurl;
      uniform float curl; uniform float dt;
      void main(){
        float L=texture2D(uCurl,vL).x, R=texture2D(uCurl,vR).x;
        float T=texture2D(uCurl,vT).x, B=texture2D(uCurl,vB).x;
        float C=texture2D(uCurl,vUv).x;
        vec2 force=0.5*vec2(abs(T)-abs(B), abs(R)-abs(L));
        force/=length(force)+0.0001;
        force*=curl*C; force.y*=-1.0;
        vec2 vel=texture2D(uVelocity,vUv).xy+force*dt;
        gl_FragColor=vec4(clamp(vel,-1000.0,1000.0),0.0,1.0);
      }`,
    pressure: `
      precision highp float;
      varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uPressure; uniform sampler2D uDivergence;
      void main(){
        float L=texture2D(uPressure,vL).x, R=texture2D(uPressure,vR).x;
        float T=texture2D(uPressure,vT).x, B=texture2D(uPressure,vB).x;
        float C=texture2D(uDivergence,vUv).x;
        gl_FragColor=vec4((L+R+B+T-C)*0.25,0.0,0.0,1.0);
      }`,
    gradientSubtract: `
      precision highp float;
      varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
      uniform sampler2D uPressure; uniform sampler2D uVelocity;
      void main(){
        float L=texture2D(uPressure,vL).x, R=texture2D(uPressure,vR).x;
        float T=texture2D(uPressure,vT).x, B=texture2D(uPressure,vB).x;
        vec2 vel=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);
        gl_FragColor=vec4(vel,0.0,1.0);
      }`,
    display: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main(){
        vec3 C = texture2D(uTexture, vUv).rgb;
        // soft gamma so edges fade smoothly, center glows
        C = pow(C, vec3(0.7));
        float a = max(C.r, max(C.g, C.b));
        gl_FragColor = vec4(C, a * 0.25);
      }`,
  };

  function compile(fs) {
    const v = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(v, VS); gl.compileShader(v);
    const f = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(f, fs); gl.compileShader(f);
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    // collect uniforms
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      uniforms[name] = gl.getUniformLocation(p, name);
    }
    return { program: p, uniforms };
  }

  const programs = {};
  for (const [k, src] of Object.entries(shaders)) programs[k] = compile(src);

  /* ── Fullscreen quad ── */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,1, 1,-1]), gl.STATIC_DRAW);
  const ibuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const loc = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  }

  /* ── FBO helpers ── */
  function createFBO(w, h, fmt, filter) {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.i, w, h, 0, fmt.f, HALF, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const texelSizeX = 1 / w, texelSizeY = 1 / h;
    return { texture: tex, fbo, width: w, height: h, texelSizeX, texelSizeY,
             attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }

  function createDoubleFBO(w, h, fmt, filter) {
    let a = createFBO(w, h, fmt, filter);
    let b = createFBO(w, h, fmt, filter);
    return {
      width: w, height: h, texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
      get read() { return a; },
      get write() { return b; },
      swap() { [a, b] = [b, a]; },
    };
  }

  /* ── Sim buffers ── */
  let simW, simH, dyeW, dyeH;
  let velocity, dye, divergence, curl, pressure;

  function initBuffers() {
    const simRes = getRes(config.SIM_RESOLUTION);
    const dyeRes = getRes(config.DYE_RESOLUTION);
    simW = simRes.w; simH = simRes.h;
    dyeW = dyeRes.w; dyeH = dyeRes.h;
    velocity  = createDoubleFBO(simW, simH, fmtRG,   filtering);
    dye       = createDoubleFBO(dyeW, dyeH, fmtRGBA, filtering);
    divergence = createFBO(simW, simH, fmtR, gl.NEAREST);
    curl       = createFBO(simW, simH, fmtR, gl.NEAREST);
    pressure   = createDoubleFBO(simW, simH, fmtR, gl.NEAREST);
  }

  function getRes(res) {
    const ar = canvas.width / canvas.height;
    if (ar >= 1) return { w: Math.round(res * ar), h: res };
    return { w: res, h: Math.round(res / ar) };
  }

  /* ── Resize ── */
  function resizeCanvas() {
    const w = Math.min(canvas.clientWidth,  1280);
    const h = Math.min(canvas.clientHeight,  720);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  /* ── Render helpers ── */
  function useProgram(key) {
    const { program, uniforms } = programs[key];
    gl.useProgram(program);
    bindQuad(program);
    return uniforms;
  }

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /* ── Splat ── */
  function splat(x, y, dx, dy, color) {
    const u = useProgram('splat');
    gl.uniform1i(u.uTarget, velocity.read.attach(0));
    gl.uniform1f(u.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(u.point, x / canvas.width, 1 - y / canvas.height);
    gl.uniform3f(u.color, dx, -dy, 0);
    gl.uniform1f(u.radius, config.SPLAT_RADIUS / 100);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(u.uTarget, dye.read.attach(0));
    gl.uniform3f(u.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  /* ── Simulation step ── */
  let lastTime = Date.now();

  function step(dt) {
    gl.disable(gl.BLEND);

    // Curl
    let u = useProgram('curl');
    gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(curl);

    // Vorticity
    u = useProgram('vorticity');
    gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uCurl, curl.attach(1));
    gl.uniform1f(u.curl, config.CURL);
    gl.uniform1f(u.dt, dt);
    blit(velocity.write);
    velocity.swap();

    // Divergence
    u = useProgram('divergence');
    gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    // Pressure clear
    u = useProgram('pressure');
    gl.uniform1i(u.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(u.uPressure, pressure.read.attach(1));
      gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      blit(pressure.write);
      pressure.swap();
    }

    // Gradient subtract
    u = useProgram('gradientSubtract');
    gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(u.uPressure, pressure.read.attach(0));
    gl.uniform1i(u.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    // Advect velocity
    u = useProgram('advection');
    gl.uniform2f(u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(u.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, velocity.read.attach(0));
    gl.uniform1f(u.dt, dt);
    gl.uniform1f(u.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    // Advect dye
    gl.uniform2f(u.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(u.uSource, dye.read.attach(1));
    gl.uniform1f(u.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  /* ── Render ── */
  function render() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const u = useProgram('display');
    gl.uniform1i(u.uTexture, dye.read.attach(0));
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /* ── Mouse ── */
  let pointers = [{ id: -1, x: -1, y: -1, dx: 0, dy: 0, down: false, moved: false, color: nextColor() }];

  const hero = canvas.closest('section') || canvas.parentElement;

  function getCanvasPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // Scale from CSS pixels to canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  let moveFrame = 0;
  hero.addEventListener('mousemove', e => {
    moveFrame++;
    if (moveFrame % 2 !== 0) return;
    const p = pointers[0];
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (!p.moved) {
      p.x = pos.x; p.y = pos.y;
      p.moved = true;
      return;
    }
    p.dx = (pos.x - p.x) * config.SPLAT_FORCE;
    p.dy = (pos.y - p.y) * config.SPLAT_FORCE;
    p.x = pos.x; p.y = pos.y;
    p.down = true;
  });

  hero.addEventListener('mouseleave', () => { pointers[0].down = false; pointers[0].moved = false; });

  hero.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    const p = pointers[0];
    const pos = getCanvasPos(t.clientX, t.clientY);
    if (!p.moved) { p.x = pos.x; p.y = pos.y; p.moved = true; return; }
    p.dx = (pos.x - p.x) * config.SPLAT_FORCE;
    p.dy = (pos.y - p.y) * config.SPLAT_FORCE;
    p.x = pos.x; p.y = pos.y;
    p.down = true;
  }, { passive: false });

  hero.addEventListener('touchend', () => { pointers[0].down = false; pointers[0].moved = false; });

  /* ── Loop ── */
  resizeCanvas();
  initBuffers();

  // Gentle auto-splats on startup
  function multipleSplats(count) {
    for (let i = 0; i < count; i++) {
      const color = nextColor();
      const x = canvas.width * Math.random();
      const y = canvas.height * Math.random();
      const dx = 150 * (Math.random() - 0.5);
      const dy = 150 * (Math.random() - 0.5);
      splat(x, y, dx, dy, color);
    }
  }
  multipleSplats(4);

  // Color cycling timer
  let colorTimer = 0;

  function loop() {
    const now = Date.now();
    const dt = Math.min((now - lastTime) / 1000, 0.016) * config.DT_SCALE;
    lastTime = now;

    if (resizeCanvas()) initBuffers();

    colorTimer += dt;
    if (colorTimer > 1.2) {
      colorTimer = 0;
      pointers[0].color = nextColor();
    }

    const p = pointers[0];
    if (p.down) {
      splat(p.x, p.y, p.dx, p.dy, p.color);
      p.dx = 0; p.dy = 0;
    }

    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  loop();
})();
