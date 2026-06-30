/* ═══════════════════════════════════════════════════════════════
   TADC — The AI-Driven Character — script.js
   Moteur de jeu 2D Pixel Art Sandbox
   Le personnage est ENTIÈREMENT contrôlé par l'IA.
   Permet d'invoquer de multiples PNJs (très rare).
   ═══════════════════════════════════════════════════════════════ */

const TILE_SIZE    = 32;
const SPRITE_SIZE  = 16;
const PLAYER_SPEED = 2;
const AI_DECISION_INTERVAL = 5500;

const API_MODELS = {
    gemini: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    ],
    mistral: [
        { id: 'mistral-small-latest',  label: 'Mistral Small' },
        { id: 'mistral-large-latest',  label: 'Mistral Large' },
    ]
};

const API_ENDPOINTS = {
    gemini:  (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    mistral: () => 'https://api.mistral.ai/v1/chat/completions'
};

const PALETTE = {
    0: 'transparent',
    1: '#09090b',    // Noir/Sombre
    2: '#3f3f46',    // Gris foncé
    3: '#a1a1aa',    // Gris clair
    4: '#fafafa',    // Blanc
    5: '#ef4444',    // Rouge
    6: '#f97316',    // Orange
    7: '#eab308',    // Jaune
    8: '#10b981',    // Vert
    9: '#3b82f6',    // Bleu
    10: '#6366f1',   // Indigo
    11: '#d946ef',   // Rose
    12: '#78350f',   // Marron
    13: '#065f46',   // Vert foncé
    14: '#1e3a8a',   // Bleu foncé
    15: '#fef3c7',   // Beige / Peau
};

// ─── ÉTAT GLOBAL ─────────────────────────────────────────────
const Game = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    gridCols: 0,
    gridRows: 0,

    // Liste de tous les personnages (le [0] est contrôlé par l'IA principale, les autres sont des PNJs)
    characters: [],

    // Cerveau IA Principal
    aiBrain: {
        enabled: false,
        paused: false,
        thinking: false,
        actionQueue: [],
        currentAction: null,
        moveTarget: null,
        lastThought: '',
        thoughtTimer: 0,
        lastDecisionTime: 0,
        decisionCount: 0,
        recentActions: [],
    },

    placedFurniture: [],
    builtinFurniture: [],
    aiFurniture: [],
    running: false,
    lastTimestamp: 0,

    apiProvider: 'gemini',
    apiModel: 'gemini-2.5-flash',
    apiKey: '',
};

// ═══════════════════════════════════════════════════════════════
// SECTION 1 : CONFIGURATION & UI
// ═══════════════════════════════════════════════════════════════

function initConfig() {
    const providerSelect = document.getElementById('api-provider');
    const modelSelect    = document.getElementById('api-model');
    const keyInput       = document.getElementById('api-key-input');
    const btnSave        = document.getElementById('btn-save-key');
    const btnStart       = document.getElementById('btn-start-game');
    const btnToggle      = document.getElementById('toggle-key-visibility');
    const status         = document.getElementById('config-status');

    const savedProvider = localStorage.getItem('tadc_provider') || 'gemini';
    const savedModel    = localStorage.getItem('tadc_model')    || '';
    const savedKey      = localStorage.getItem('tadc_apikey')   || '';

    providerSelect.value = savedProvider;
    Game.apiProvider = savedProvider;
    populateModels(savedProvider, savedModel);

    if (savedKey) {
        keyInput.value = savedKey;
        Game.apiKey = savedKey;
        btnStart.disabled = false;
        status.textContent = 'Clé API chargée.';
        status.className = 'status-msg success';
    }

    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        Game.apiProvider = provider;
        localStorage.setItem('tadc_provider', provider);
        populateModels(provider, '');
    });

    modelSelect.addEventListener('change', () => {
        Game.apiModel = modelSelect.value;
        localStorage.setItem('tadc_model', modelSelect.value);
    });

    btnToggle.addEventListener('click', () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });

    btnSave.addEventListener('click', () => {
        const key = keyInput.value.trim();
        if (!key) {
            status.textContent = 'Veuillez entrer une clé API valide.';
            status.className = 'status-msg error';
            return;
        }
        localStorage.setItem('tadc_apikey', key);
        Game.apiKey = key;
        btnStart.disabled = false;
        status.textContent = 'Clé sauvegardée.';
        status.className = 'status-msg success';
    });

    btnStart.addEventListener('click', () => {
        Game.apiKey = keyInput.value.trim() || Game.apiKey;
        if (!Game.apiKey) {
            status.textContent = 'Clé API requise.';
            status.className = 'status-msg error';
            return;
        }
        localStorage.setItem('tadc_apikey', Game.apiKey);
        document.getElementById('title-screen').classList.remove('visible');
        document.getElementById('game-container').classList.remove('hidden');
        initGame();
    });
}

function populateModels(provider, preselect) {
    const modelSelect = document.getElementById('api-model');
    modelSelect.innerHTML = '';
    const models = API_MODELS[provider] || [];
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
    });
    if (preselect && models.find(m => m.id === preselect)) {
        modelSelect.value = preselect;
    }
    Game.apiModel = modelSelect.value;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2 : MOTEUR DE JEU
// ═══════════════════════════════════════════════════════════════

function initGame() {
    Game.canvas = document.getElementById('game-canvas');
    Game.ctx    = Game.canvas.getContext('2d');
    Game.ctx.imageSmoothingEnabled = false;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    initBuiltinFurniture();
    renderFurniturePalette();
    setupSidebarButtons();

    Game.running = true;
    Game.lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);

    showToast('Environnement TADC initialisé.', 'info');
}

function resizeCanvas() {
    const sidebar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
    const hud     = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hud-height'));

    Game.width  = window.innerWidth - sidebar;
    Game.height = window.innerHeight - hud;
    Game.canvas.width  = Game.width;
    Game.canvas.height = Game.height;
    Game.gridCols = Math.ceil(Game.width  / TILE_SIZE);
    Game.gridRows = Math.ceil(Game.height / TILE_SIZE);
    Game.ctx.imageSmoothingEnabled = false;
}

function gameLoop(timestamp) {
    if (!Game.running) return;
    const dt = timestamp - Game.lastTimestamp;
    Game.lastTimestamp = timestamp;

    update(dt);
    render();

    requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3 : LOGIQUE
// ═══════════════════════════════════════════════════════════════

function update(dt) {
    if (Game.characters.length === 0) return;

    // --- Mise à jour IA Principale (Personnage 0) ---
    const brain = Game.aiBrain;
    const mainChar = Game.characters[0];

    if (brain.currentAction) {
        executeCurrentAction(mainChar, brain, dt);
    } else if (brain.actionQueue.length > 0) {
        brain.currentAction = brain.actionQueue.shift();
        startAction(mainChar, brain, brain.currentAction);
        updateActionDisplay();
    } else if (brain.enabled && !brain.paused && !brain.thinking) {
        const now = performance.now();
        if (now - brain.lastDecisionTime > AI_DECISION_INTERVAL) {
            requestAIDecision();
        }
    }

    if (brain.thoughtTimer > 0) brain.thoughtTimer -= dt;

    // --- Mise à jour PNJs (Autres personnages) ---
    for (let i = 1; i < Game.characters.length; i++) {
        updateNPC(Game.characters[i], dt);
    }

    // --- HUD ---
    const tileX = Math.floor(mainChar.x / TILE_SIZE);
    const tileY = Math.floor(mainChar.y / TILE_SIZE);
    document.getElementById('hud-coords').textContent = `Pos: (${tileX}, ${tileY})`;

    const statusEl = document.getElementById('hud-ai-status');
    if (brain.thinking) {
        statusEl.textContent = 'Réflexion…';
        statusEl.className = 'badge badge-active';
    } else if (brain.paused) {
        statusEl.textContent = 'En pause';
        statusEl.className = 'badge';
    } else if (brain.currentAction) {
        statusEl.textContent = 'Actif';
        statusEl.className = 'badge badge-active';
    } else {
        statusEl.textContent = 'En attente';
        statusEl.className = 'badge';
    }
}

// --- Logique PNJ (marche aléatoire simple) ---
function updateNPC(npc, dt) {
    if (npc.currentAction) {
        executeCurrentAction(npc, npc, dt);
    } else if (npc.actionQueue.length > 0) {
        npc.currentAction = npc.actionQueue.shift();
        startAction(npc, npc, npc.currentAction);
    } else {
        npc.actionQueue = generateFallbackActions();
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4 : CERVEAU IA (Prompt & Parsing)
// ═══════════════════════════════════════════════════════════════

function buildStateDescription() {
    const p = Game.characters[0];
    const tileX = Math.floor(p.x / TILE_SIZE);
    const tileY = Math.floor(p.y / TILE_SIZE);

    const availableFurniture = [...Game.builtinFurniture, ...Game.aiFurniture].map(f => f.name).join(', ');

    let placedDesc = 'Aucun';
    if (Game.placedFurniture.length > 0) {
        placedDesc = Game.placedFurniture.map(f => {
            const def = getFurnitureDef(f.furnitureId, f.isAI);
            return `${def ? def.name : 'inconnu'} à (${Math.floor(f.x/TILE_SIZE)},${Math.floor(f.y/TILE_SIZE)})`;
        }).join('; ');
    }

    let npcDesc = Game.characters.length > 1 
        ? `\n- Amis présents : ${Game.characters.length - 1} amis se promènent.`
        : '';

    const history = Game.aiBrain.recentActions.length > 0
        ? Game.aiBrain.recentActions.slice(-5).join(' → ')
        : 'Aucune';

    return `ÉTAT DU JEU :
- Pièce : ${Game.gridCols}x${Game.gridRows} tuiles
- Ta position : (${tileX}, ${tileY}), direction: ${p.dir}
- Meubles disponibles à placer : [${availableFurniture}]
- Meubles déjà placés : ${placedDesc}${npcDesc}
- Historique récent : ${history}
- Décision n°${Game.aiBrain.decisionCount + 1}`;
}

async function requestAIDecision() {
    const brain = Game.aiBrain;
    brain.thinking = true;
    brain.lastDecisionTime = performance.now();

    document.getElementById('ai-thought-text').textContent = 'Analyse de l\'environnement…';
    document.getElementById('ai-action-text').textContent  = 'Réflexion IA en cours…';

    const state = buildStateDescription();

    const prompt = `Tu es une IA contrôlant un personnage autonome dans un bac à sable 2D pixel art. Tu explores et décores ta pièce.

${state}

Retourne un objet JSON strict avec :
- "thought" : phrase décrivant ta pensée/ton humeur (max 60 car.)
- "actions" : tableau de 3 à 6 actions à exécuter.

Actions possibles :
- {"type":"move","direction":"up|down|left|right","tiles":1 à 4} — te déplacer
- {"type":"place","furniture":"nom exact du meuble"} — placer un meuble devant toi
- {"type":"remove"} — retirer le meuble devant toi
- {"type":"wait","seconds":1 à 3} — observer
- {"type":"turn","direction":"up|down|left|right"} — pivoter
- {"type":"spawn_character","name":"Nom"} — TRÈS RARE (1% du temps max). Invoque un nouvel ami PNJ autonome si tu te sens trop seul. N'utilise ça que si c'est vraiment pertinent.

Règles :
- Ne sors pas de la pièce (X:0 à ${Game.gridCols-1}, Y:0 à ${Game.gridRows-1}).
- Sois créatif. Utilise SEULEMENT les noms de meubles listés.
- Réponds UNIQUEMENT avec le JSON validé, pas de texte.`;

    try {
        const response = await callAI(prompt);
        const decision = parseDecisionFromAIResponse(response);
        brain.decisionCount++;

        if (decision.thought) {
            brain.lastThought = decision.thought;
            brain.thoughtTimer = 6000;
            document.getElementById('ai-thought-text').textContent = `"${decision.thought}"`;
        }

        if (decision.actions && decision.actions.length > 0) {
            brain.actionQueue = decision.actions;
            brain.recentActions.push(decision.thought || 'action');
            if (brain.recentActions.length > 10) brain.recentActions.shift();
        } else {
            brain.actionQueue = [{ type: 'wait', seconds: 2 }];
        }
        brain.thinking = false;
    } catch (err) {
        console.error('Erreur IA :', err);
        brain.thinking = false;
        document.getElementById('ai-thought-text').textContent = 'Anomalie réseau…';
        showToast(`Erreur IA : ${err.message}`, 'error');
        brain.actionQueue = generateFallbackActions();
        brain.lastDecisionTime = performance.now();
    }
}

function parseDecisionFromAIResponse(text) {
    const codeBlockRegex = /```(?:json|javascript|js)?\s*\n?([\s\S]*?)```/;
    const match = text.match(codeBlockRegex);
    let jsonStr = match ? match[1].trim() : text.trim();
    const objMatch = jsonStr.match(/(\{[\s\S]*\})/);
    if (objMatch) jsonStr = objMatch[1];
    
    jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
    jsonStr = jsonStr.replace(/,\s*([\]\}])/g, '$1');

    try {
        const parsed = JSON.parse(jsonStr);
        return { thought: parsed.thought || '', actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
    } catch (e) {
        return { thought: '...', actions: [] };
    }
}

function generateFallbackActions() {
    const dirs = ['up', 'down', 'left', 'right'];
    const actions = [];
    for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.6) {
            actions.push({ type: 'move', direction: dirs[Math.floor(Math.random() * 4)], tiles: 1 + Math.floor(Math.random() * 3) });
        } else {
            actions.push({ type: 'wait', seconds: 1 + Math.random() });
        }
    }
    return actions;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5 : EXÉCUTION DES ACTIONS
// ═══════════════════════════════════════════════════════════════

function startAction(char, brain, action) {
    switch (action.type) {
        case 'move': {
            const tiles = Math.min(Math.max(action.tiles || 1, 1), 6);
            const dir   = action.direction || 'down';
            char.dir = dir;

            let targetX = char.x, targetY = char.y;
            if (dir === 'up') targetY -= tiles * TILE_SIZE;
            if (dir === 'down') targetY += tiles * TILE_SIZE;
            if (dir === 'left') targetX -= tiles * TILE_SIZE;
            if (dir === 'right') targetX += tiles * TILE_SIZE;

            targetX = Math.max(0, Math.min(targetX, (Game.gridCols - 1) * TILE_SIZE));
            targetY = Math.max(0, Math.min(targetY, (Game.gridRows - 1) * TILE_SIZE));

            brain.moveTarget = { x: targetX, y: targetY };
            break;
        }
        case 'place': {
            const fName = (action.furniture || '').toLowerCase();
            const all = [...Game.builtinFurniture, ...Game.aiFurniture];
            const def = all.find(f => f.name.toLowerCase() === fName);
            if (def) {
                placeFurniture(char, def);
                if (brain === Game.aiBrain) highlightPaletteItem(def.id);
            }
            brain.currentAction = null;
            break;
        }
        case 'remove': {
            removeFurniture(char);
            brain.currentAction = null;
            break;
        }
        case 'turn': {
            const dir = action.direction || 'down';
            if (['up', 'down', 'left', 'right'].includes(dir)) char.dir = dir;
            brain.currentAction = null;
            break;
        }
        case 'wait': {
            action._remaining = (action.seconds || 1) * 1000;
            break;
        }
        case 'spawn_character': {
            if (brain === Game.aiBrain) {
                generateNPCWithAI(action.name || 'Ami inconnu');
            }
            brain.currentAction = null;
            break;
        }
        default: {
            brain.currentAction = null;
            break;
        }
    }
}

function executeCurrentAction(char, brain, dt) {
    const action = brain.currentAction;
    if (!action) return;

    if (action.type === 'move') {
        const target = brain.moveTarget;
        if (!target) { brain.currentAction = null; return; }

        const dx = target.x - char.x;
        const dy = target.y - char.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < PLAYER_SPEED) {
            char.x = target.x;
            char.y = target.y;
            brain.moveTarget = null;
            brain.currentAction = null;
        } else {
            const nx = dx / dist;
            const ny = dy / dist;
            let newX = char.x + nx * PLAYER_SPEED;
            let newY = char.y + ny * PLAYER_SPEED;

            // Simple collision
            let blocked = false;
            const cRect = { x: newX, y: newY, w: char.width, h: char.height };
            for (const f of Game.placedFurniture) {
                const fdef = getFurnitureDef(f.furnitureId, f.isAI);
                if (!fdef) continue;
                const fRect = { x: f.x, y: f.y, w: (fdef.tilesW||1)*TILE_SIZE, h: (fdef.tilesH||1)*TILE_SIZE };
                if (rectsOverlap(cRect, fRect)) { blocked = true; break; }
            }

            if (blocked) {
                brain.moveTarget = null;
                brain.currentAction = null;
            } else {
                char.x = newX;
                char.y = newY;
            }
        }
    } else if (action.type === 'wait') {
        action._remaining -= dt;
        if (action._remaining <= 0) brain.currentAction = null;
    }
}

function getTargetTile(char) {
    const px = Math.round(char.x / TILE_SIZE);
    const py = Math.round(char.y / TILE_SIZE);
    if (char.dir === 'up') return { x: px, y: py - 1 };
    if (char.dir === 'down') return { x: px, y: py + 1 };
    if (char.dir === 'left') return { x: px - 1, y: py };
    if (char.dir === 'right') return { x: px + 1, y: py };
    return { x: px, y: py + 1 };
}

function placeFurniture(char, def) {
    const target = getTargetTile(char);
    const tw = def.tilesW || 1;
    const th = def.tilesH || 1;

    if (target.x < 0 || target.y < 0 || target.x + tw > Game.gridCols || target.y + th > Game.gridRows) return;

    const newRect = { x: target.x*TILE_SIZE, y: target.y*TILE_SIZE, w: tw*TILE_SIZE, h: th*TILE_SIZE };

    for (const f of Game.placedFurniture) {
        const fd = getFurnitureDef(f.furnitureId, f.isAI);
        if (!fd) continue;
        const eRect = { x: f.x, y: f.y, w: (fd.tilesW||1)*TILE_SIZE, h: (fd.tilesH||1)*TILE_SIZE };
        if (rectsOverlap(newRect, eRect)) return;
    }

    Game.placedFurniture.push({
        x: target.x*TILE_SIZE, y: target.y*TILE_SIZE,
        furnitureId: def.id, isAI: !Game.builtinFurniture.includes(def)
    });
}

function removeFurniture(char) {
    const target = getTargetTile(char);
    const wX = target.x * TILE_SIZE, wY = target.y * TILE_SIZE;

    const idx = Game.placedFurniture.findIndex(f => {
        const def = getFurnitureDef(f.furnitureId, f.isAI);
        if (!def) return false;
        const fw = (def.tilesW||1)*TILE_SIZE, fh = (def.tilesH||1)*TILE_SIZE;
        return wX >= f.x && wX < f.x + fw && wY >= f.y && wY < f.y + fh;
    });

    if (idx !== -1) Game.placedFurniture.splice(idx, 1);
}

function getFurnitureDef(id, isAI) {
    return isAI ? Game.aiFurniture.find(f => f.id === id) : Game.builtinFurniture.find(f => f.id === id);
}
function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function describeAction(action) {
    if (!action) return '—';
    const dict = { up: 'haut', down: 'bas', left: 'gauche', right: 'droite' };
    switch (action.type) {
        case 'move': return `Déplacement ${dict[action.direction] || ''}`;
        case 'place': return `Placement: ${action.furniture}`;
        case 'remove': return 'Suppression objet';
        case 'wait': return 'Analyse...';
        case 'turn': return `Rotation ${dict[action.direction] || ''}`;
        case 'spawn_character': return 'Invocation en cours !';
        default: return action.type;
    }
}
function updateActionDisplay() {
    const a = Game.aiBrain.currentAction;
    document.getElementById('ai-action-text').textContent = a ? describeAction(a) : (Game.aiBrain.actionQueue.length ? 'En chaîne...' : '—');
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6 : RENDU
// ═══════════════════════════════════════════════════════════════

function render() {
    const ctx = Game.ctx;
    ctx.clearRect(0, 0, Game.width, Game.height);
    drawFloor(ctx);

    // Meubles
    for (const f of Game.placedFurniture) {
        const def = getFurnitureDef(f.furnitureId, f.isAI);
        if (!def || !def.canvas) continue;
        ctx.drawImage(def.canvas, f.x, f.y, (def.tilesW||1)*TILE_SIZE, (def.tilesH||1)*TILE_SIZE);
    }

    // Personnages
    if (Game.characters.length === 0) {
        drawPlaceholderPlayer(ctx);
    } else {
        Game.characters.forEach((char, index) => {
            if (char.spriteCanvas) {
                ctx.drawImage(char.spriteCanvas, Math.round(char.x), Math.round(char.y), char.width, char.height);
                drawDirectionIndicator(ctx, char);
                
                // Bulle de pensée pour le joueur principal
                if (index === 0 && Game.aiBrain.lastThought && Game.aiBrain.thoughtTimer > 0) {
                    drawThoughtBubble(ctx, char, Game.aiBrain.lastThought, Game.aiBrain.thoughtTimer);
                }
                if (index === 0 && Game.aiBrain.thinking) {
                    drawThinkingIndicator(ctx, char);
                }
            }
        });
    }
}

function drawFloor(ctx) {
    const c1 = '#09090b', c2 = '#131316';
    for (let r = 0; r < Game.gridRows; r++) {
        for (let c = 0; c < Game.gridCols; c++) {
            ctx.fillStyle = (r+c)%2===0 ? c1 : c2;
            ctx.fillRect(c*TILE_SIZE, r*TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }
    // Bordures stylisées
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, Game.gridCols*TILE_SIZE, 2);
    ctx.fillRect(0, 0, 2, Game.gridRows*TILE_SIZE);
    ctx.fillRect(Game.gridCols*TILE_SIZE-2, 0, 2, Game.gridRows*TILE_SIZE);
    ctx.fillRect(0, Game.gridRows*TILE_SIZE-2, Game.gridCols*TILE_SIZE, 2);
}

function drawPlaceholderPlayer(ctx) {
    const px = Game.width / 2 - TILE_SIZE / 2;
    const py = Game.height / 2 - TILE_SIZE / 2;
    ctx.globalAlpha = 0.5 + 0.2*Math.sin(Date.now()/500);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(px+4, py+2, TILE_SIZE-8, TILE_SIZE-4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fafafa';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('En attente de l\'IA', px + TILE_SIZE/2, py - 10);
}

function drawDirectionIndicator(ctx, char) {
    const cx = Math.round(char.x) + char.width / 2;
    const cy = Math.round(char.y) + char.height / 2;
    const s = 4;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.beginPath();
    if (char.dir === 'up') { ctx.moveTo(cx, char.y-2); ctx.lineTo(cx-s, char.y+2); ctx.lineTo(cx+s, char.y+2); }
    if (char.dir === 'down') { ctx.moveTo(cx, char.y+char.height+4); ctx.lineTo(cx-s, char.y+char.height); ctx.lineTo(cx+s, char.y+char.height); }
    if (char.dir === 'left') { ctx.moveTo(char.x-2, cy); ctx.lineTo(char.x+2, cy-s); ctx.lineTo(char.x+2, cy+s); }
    if (char.dir === 'right') { ctx.moveTo(char.x+char.width+4, cy); ctx.lineTo(char.x+char.width, cy-s); ctx.lineTo(char.x+char.width, cy+s); }
    ctx.fill();
}

function drawThoughtBubble(ctx, char, text, timer) {
    const px = Math.round(char.x) + char.width/2;
    const py = Math.round(char.y) - 14;
    ctx.globalAlpha = timer < 1000 ? timer/1000 : 1;

    ctx.font = 'bold 13px system-ui, sans-serif';
    
    // Découpage du texte en plusieurs lignes
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';
    const maxW = 150;
    
    for (let i = 0; i < words.length; i++) {
        const testLine = currentLine + words[i] + ' ';
        if (ctx.measureText(testLine).width > maxW && i > 0) {
            lines.push(currentLine);
            currentLine = words[i] + ' ';
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);

    let maxLineW = 0;
    for(let line of lines) {
        maxLineW = Math.max(maxLineW, ctx.measureText(line).width);
    }
    
    const bubbleW = maxLineW + 24; 
    const bubbleH = (lines.length * 16) + 16;
    const bx = px - bubbleW/2;
    const by = py - bubbleH - 10;

    // Fond Néon
    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    ctx.beginPath(); ctx.roundRect(bx, by, bubbleW, bubbleH, 8); ctx.fill();
    // Bordure
    ctx.strokeStyle = '#a855f7'; 
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, bubbleW, bubbleH, 8); ctx.stroke();
    
    // Triangle pointant vers le bas
    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    ctx.beginPath(); ctx.moveTo(px-6, by+bubbleH-1); ctx.lineTo(px, by+bubbleH+8); ctx.lineTo(px+6, by+bubbleH-1); ctx.fill();
    
    ctx.beginPath(); ctx.moveTo(px-6, by+bubbleH); ctx.lineTo(px, by+bubbleH+8); ctx.lineTo(px+6, by+bubbleH); ctx.stroke();
    // Effacer la ligne du dessus
    ctx.strokeStyle = 'rgba(26, 26, 46, 1)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px-5, by+bubbleH); ctx.lineTo(px+5, by+bubbleH); ctx.stroke();

    ctx.fillStyle = '#e8e8f0';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    
    const startY = by + 16;
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), px, startY + (i * 16));
    }
    
    ctx.globalAlpha = 1;
}

function drawThinkingIndicator(ctx, char) {
    const px = Math.round(char.x) + char.width/2;
    const py = Math.round(char.y) - 22;
    const phase = Math.floor(Date.now()/300) % 4;
    for(let i=0; i<3; i++) {
        ctx.fillStyle = i < phase ? '#3b82f6' : '#27272a';
        ctx.beginPath(); ctx.arc(px - 10 + i*10, py, 2.5, 0, Math.PI*2); ctx.fill();
    }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 7 : MEUBLES PRÉDÉFINIS & PALETTE
// ═══════════════════════════════════════════════════════════════

function initBuiltinFurniture() {
    Game.builtinFurniture = [
        { id: 'chair', name: 'Chaise', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, [
            [0,0,0,0,12,12,12,12,12,0,0,0,0,0,0,0],
            [0,0,0,0,12,6,6,6,12,0,0,0,0,0,0,0],
            [0,0,0,0,12,6,6,6,12,0,0,0,0,0,0,0],
            [0,0,0,0,12,12,12,12,12,0,0,0,0,0,0,0],
            [0,0,0,12,12,12,12,12,12,12,0,0,0,0,0,0],
            [0,0,12,6,6,6,6,6,6,12,0,0,0,0,0,0],
            [0,0,12,6,6,6,6,6,6,12,0,0,0,0,0,0],
            [0,0,12,12,12,12,12,12,12,12,0,0,0,0,0,0],
            [0,0,12,0,0,0,0,0,0,12,0,0,0,0,0,0],
            [0,0,12,0,0,0,0,0,0,12,0,0,0,0,0,0],
            [0,0,12,0,0,0,0,0,0,12,0,0,0,0,0,0],
            [0,0,12,0,0,0,0,0,0,12,0,0,0,0,0,0],
            [0,0,12,0,0,0,0,0,0,12,0,0,0,0,0,0]
        ])},
        { id: 'desk', name: 'Bureau', tilesW: 2, tilesH: 1, canvas: createSpriteFromMatrix(32,16, Array(16).fill().map((_,y) => Array(32).fill().map((_,x) => (y<=3 && x>1 && x<30)?12: (y>3 && y<14 && ((x>3&&x<6)||(x>26&&x<29)))?12:0 ))) },
        { id: 'rug', name: 'Tapis', tilesW: 2, tilesH: 2, canvas: createSpriteFromMatrix(32,32, Array(32).fill().map((_,y) => Array(32).fill().map((_,x) => (x>2&&x<29&&y>2&&y<29)?(x%2===y%2?5:12):0 ))) },
        { id: 'chest', name: 'Coffre', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (y>4&&y<14&&x>1&&x<14)? (y===9?7:12) :0 ))) },
        { id: 'plant', name: 'Plante', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (y>10&&x>4&&x<11)?12 : (y>2&&y<=10&&Math.abs(x-7)<4)?8:0 ))) },
        { id: 'bed', name: 'Lit', tilesW: 1, tilesH: 2, canvas: createSpriteFromMatrix(16,32, Array(32).fill().map((_,y) => Array(16).fill().map((_,x) => (x>1&&x<14)? (y<4?12 : y<10?4 : y<28?9 : y<30?12:0):0 ))) },
        
        /* ----- 10 NOUVEAUX MEUBLES (Bonus) ----- */
        { id: 'tv', name: 'Télévision', tilesW: 2, tilesH: 1, canvas: createSpriteFromMatrix(32,16, Array(16).fill().map((_,y) => Array(32).fill().map((_,x) => (y>2&&y<14&&x>2&&x<29)? (y>4&&y<12&&x>4&&x<27?9:1) : 0))) },
        { id: 'sofa', name: 'Canapé', tilesW: 2, tilesH: 1, canvas: createSpriteFromMatrix(32,16, Array(16).fill().map((_,y) => Array(32).fill().map((_,x) => (y>2&&y<14&&x>1&&x<30)? (y<8?5:11) : 0))) },
        { id: 'bookshelf', name: 'Bibliothèque', tilesW: 1, tilesH: 2, canvas: createSpriteFromMatrix(16,32, Array(32).fill().map((_,y) => Array(16).fill().map((_,x) => (x>1&&x<14&&y>2&&y<30)? (x===2||x===13||y===2||y===12||y===20||y===29 ? 12 : (Math.random()>0.4?((x*y)%3+5):0)) : 0))) },
        { id: 'statue', name: 'Statue', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (y>10&&x>2&&x<13)?2 : (y>2&&y<=10&&Math.abs(x-7.5)<3)?3:0 ))) },
        { id: 'potion', name: 'Potion Magique', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (y>5&&y<14&&x>3&&x<12)? (y>9?10:4) : (y>2&&y<=5&&x>6&&x<9)?1:0 ))) },
        { id: 'sword', name: 'Épée Légendaire', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (x===y&&x>2&&x<14)?4 : (Math.abs(x-y)===1&&x>2&&x<12)?9 : (x+y===16&&x>10)?7 : 0 ))) },
        { id: 'computer', name: 'Ordinateur', tilesW: 1, tilesH: 1, canvas: createSpriteFromMatrix(16,16, Array(16).fill().map((_,y) => Array(16).fill().map((_,x) => (y>2&&y<9&&x>2&&x<13)? (y>3&&y<8&&x>3&&x<12?8:1) : (y===12&&x>3&&x<12)?1 : 0))) },
        { id: 'lamp', name: 'Lampadaire', tilesW: 1, tilesH: 2, canvas: createSpriteFromMatrix(16,32, Array(32).fill().map((_,y) => Array(16).fill().map((_,x) => (y<8&&x>3&&x<12)?7 : (y>=8&&y<30&&x>6&&x<9)?1 : (y>=30&&x>4&&x<11)?2:0 ))) },
        { id: 'fireplace', name: 'Cheminée', tilesW: 2, tilesH: 2, canvas: createSpriteFromMatrix(32,32, Array(32).fill().map((_,y) => Array(32).fill().map((_,x) => (x>4&&x<27&&y>4&&y<30)? ((y>16&&x>8&&x<23)? (Math.random()>0.5?6:5) : 3) : 0))) },
        { id: 'fountain', name: 'Fontaine', tilesW: 2, tilesH: 2, canvas: createSpriteFromMatrix(32,32, Array(32).fill().map((_,y) => Array(32).fill().map((_,x) => { const d = Math.sqrt((x-16)**2+(y-16)**2); return d>12?0: (d>10?3 : d<4?4:9); }))) }
    ];
}

function renderFurniturePalette() {
    const c1 = document.getElementById('furniture-palette');
    c1.innerHTML = '';
    Game.builtinFurniture.forEach(f => c1.appendChild(createPaletteElement(f)));
    
    const c2 = document.getElementById('ai-furniture-palette');
    c2.innerHTML = '';
    if (Game.aiFurniture.length === 0) c2.innerHTML = '<p style="font-size:0.75rem;color:var(--text-muted);grid-column:1/-1;">Vide</p>';
    else Game.aiFurniture.forEach(f => c2.appendChild(createPaletteElement(f)));
}

function createPaletteElement(f) {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.dataset.furnitureId = f.id;
    if (f.canvas) {
        const cv = document.createElement('canvas');
        const aspect = f.canvas.width / f.canvas.height;
        cv.width = aspect >= 1 ? 64 : Math.round(64 * aspect);
        cv.height = aspect >= 1 ? Math.round(64 / aspect) : 64;
        cv.style.maxWidth = '100%';
        cv.style.maxHeight = '45px';
        cv.style.objectFit = 'contain';
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(f.canvas, 0, 0, cv.width, cv.height);
        el.appendChild(cv);
    }
    const lbl = document.createElement('span');
    lbl.className = 'palette-item-label';
    lbl.textContent = f.name;
    el.appendChild(lbl);
    return el;
}
function highlightPaletteItem(id) {
    document.querySelectorAll('.palette-item').forEach(el => {
        el.classList.remove('highlighted');
        if(el.dataset.furnitureId === id) {
            el.classList.add('highlighted');
            setTimeout(()=>el.classList.remove('highlighted'), 1500);
        }
    });
}

function createSpriteFromMatrix(w, h, m) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    for (let y = 0; y < Math.min(h, m.length); y++) {
        const row = m[y]; if(!row) continue;
        for (let x = 0; x < Math.min(w, row.length); x++) {
            if (row[x]!==0) { ctx.fillStyle = PALETTE[row[x]]||PALETTE[1]; ctx.fillRect(x, y, 1, 1); }
        }
    }
    return cvs;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8 : INTÉGRATION IA (GÉNÉRATIONS)
// ═══════════════════════════════════════════════════════════════

async function callAI(prompt) {
    const prov = Game.apiProvider, model = Game.apiModel, key = Game.apiKey;
    if (!key) throw new Error('Clé API manquante');

    if (prov === 'gemini') {
        const res = await fetch(API_ENDPOINTS.gemini(model, key), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) throw new Error(`Gemini Erreur ${res.status}`);
        const data = await res.json();
        return data.candidates[0].content.parts[0].text;
    } else {
        const res = await fetch(API_ENDPOINTS.mistral(), {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
        });
        if (!res.ok) throw new Error(`Mistral Erreur ${res.status}`);
        const data = await res.json();
        return data.choices[0].message.content;
    }
}

function parseMatrixFromText(text) {
    const match = text.match(/```(?:json|js)?\s*\n?([\s\S]*?)```/);
    let str = match ? match[1].trim() : text.trim();
    const arrMatch = str.match(/(\[\s*\[[\s\S]*\]\s*\])/);
    if(arrMatch) str = arrMatch[1];
    str = str.replace(/\/\/.*$/gm, '').replace(/,\s*([\]\}])/g, '$1');
    try { return JSON.parse(str); } catch (e) {
        try { return Function('"use strict"; return (' + str + ')')(); } catch(e2) { throw new Error('Format invalide'); }
    }
}

async function generateCharacterWithAI(isNPC = false, npcName = '') {
    showLoading(isNPC ? `Génération de l'ami: ${npcName}…` : 'Création du protagoniste…');

    const prompt = `Génère un sprite pixel art (matrice 16x16) d'un personnage de face.
Palette 0 à 15. Réponds JUSTE avec le tableau JSON \`[[...]]\`.`;

    try {
        const matrix = parseMatrixFromText(await callAI(prompt));
        const canvas = createSpriteFromMatrix(matrix[0].length, matrix.length, matrix);

        const charObj = {
            x: Math.floor(Game.gridCols / 2) * TILE_SIZE + (isNPC ? (Math.random()-0.5)*100 : 0),
            y: Math.floor(Game.gridRows / 2) * TILE_SIZE + (isNPC ? (Math.random()-0.5)*100 : 0),
            dir: 'down',
            width: TILE_SIZE, height: TILE_SIZE,
            spriteCanvas: canvas,
            actionQueue: [], currentAction: null, moveTarget: null
        };

        if (isNPC) {
            Game.characters.push(charObj);
            showToast(`L'ami "${npcName}" est arrivé !`, 'ai');
        } else {
            Game.characters = [charObj];
            Game.aiBrain.enabled = true;
            Game.aiBrain.paused = false;
            Game.aiBrain.lastDecisionTime = 0;
            document.getElementById('btn-ai-pause').disabled = false;
            document.getElementById('btn-ai-nudge').disabled = false;
            showToast('Personnage principal généré !', 'success');
        }
    } catch(err) {
        showToast('Erreur: ' + err.message, 'error');
    }
    hideLoading();
}

async function generateNPCWithAI(name) {
    await generateCharacterWithAI(true, name);
}

async function generateFurnitureWithAI() {
    showLoading('L\'IA conçoit un nouveau meuble…');
    const types = ['un canapé', 'une fontaine', 'une horloge', 'une armoire magique', 'une table de chevet', 'un globe terrestre', 'un ordinateur rétro'];
    const prompt = `Crée un meuble de type "${types[Math.floor(Math.random()*types.length)]}" en pixel art. 
Palette 0-15.
Format strict: {"name":"Nom","tilesW":1,"tilesH":1,"matrix":[[...]]}`;
    try {
        const text = await callAI(prompt);
        let str = (text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) || [null, text])[1].trim();
        str = str.match(/(\{[\s\S]*\})/)[1];
        const obj = JSON.parse(str.replace(/,\s*([\]\}])/g, '$1'));
        
        Game.aiFurniture.push({
            id: 'ai_'+Date.now(), name: obj.name, tilesW: obj.tilesW||1, tilesH: obj.tilesH||1,
            canvas: createSpriteFromMatrix(obj.matrix[0].length, obj.matrix.length, obj.matrix)
        });
        renderFurniturePalette();
        showToast(`${obj.name} a été ajouté au catalogue.`, 'ai');
    } catch(err) { showToast('Erreur génération: ' + err.message, 'error'); }
    hideLoading();
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9 : UI & EVENTS
// ═══════════════════════════════════════════════════════════════

function setupSidebarButtons() {
    document.getElementById('btn-generate-character').addEventListener('click', () => generateCharacterWithAI(false));
    document.getElementById('btn-generate-furniture').addEventListener('click', () => generateFurnitureWithAI());
    document.getElementById('btn-ai-pause').addEventListener('click', () => {
        Game.aiBrain.paused = !Game.aiBrain.paused;
        document.getElementById('btn-ai-pause').textContent = Game.aiBrain.paused ? 'Relancer' : 'Mettre en pause';
    });
    document.getElementById('btn-ai-nudge').addEventListener('click', () => {
        Game.aiBrain.actionQueue = []; Game.aiBrain.currentAction = null; Game.aiBrain.lastDecisionTime = 0;
    });
    document.getElementById('btn-clear-furniture').addEventListener('click', () => { Game.placedFurniture = []; });
    document.getElementById('btn-back-title').addEventListener('click', () => {
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('title-screen').classList.add('visible');
    });
}

function showLoading(txt) {
    document.getElementById('ai-loading-text').textContent = txt;
    document.getElementById('ai-loading').classList.remove('hidden');
    document.getElementById('ai-loading').classList.add('visible');
}
function hideLoading() {
    const el = document.getElementById('ai-loading');
    el.classList.remove('visible');
    setTimeout(() => el.classList.add('hidden'), 300);
}
function showToast(msg, type='info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(()=>toast.remove(),200); }, 3500);
}

document.addEventListener('DOMContentLoaded', initConfig);
