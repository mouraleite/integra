function formatVistoriaUnidade(v) {
    const raw = String((v && v.unidade) || "").trim();
    const blank = !raw || /^n\/d$/i.test(raw) || /^unidade\s*n\/d$/i.test(raw) || raw === "-" || raw === "—";
    const unit = blank ? "" : raw.replace(/^unidade\s+/i, "");
    const cc = String((v && (v.costCenterId || v.enterpriseId)) || "").trim();
    const titulo = String((v && (v.titulo || v.tituloKey)) || "").trim();
    const parts = [];
    if (cc && unit) parts.push(cc + " · " + unit);
    else if (unit) parts.push(unit);
    else if (cc) parts.push(cc);
    if (titulo && !/^n\/d$/i.test(titulo)) parts.push("Título " + titulo);
    return parts.join(" — ") || "Unidade não informada";
}

let currentVistoriaId = null;
let currentVistoriaDoc = null;
let loteCoords = null; // {lat, lng}
let hasKmzReference = false;
let currentDistance = Infinity;
const MAX_DISTANCE = 25; // meters
const files = { file1: null, file2: null, file3: null };

// Lista de lotes carregados
let loadedVistorias = [];
let watchId = null;

// Dados da vistoria: rota do servidor /api/vistoria-publica (o banco Supabase não aceita acesso sem login).
// As fotos continuam indo para o Firebase Storage (só o Storage usa o firebase-config.js aqui).
const API_VISTORIA = '/api/vistoria-publica';

// Aguardar o Firebase Storage estar disponível (só para o upload das fotos)
async function waitForFirebase() {
    let retries = 50;
    while (!window.firebaseStorage && retries > 0) {
        await new Promise(r => setTimeout(r, 100));
        retries--;
    }
    if (!window.firebaseStorage) throw new Error("Falha ao inicializar o envio de fotos. Verifique sua conexão.");
}

async function lerRespostaApi(r) {
    let dados = null;
    try { dados = await r.json(); } catch (e) { dados = null; }
    if (!r.ok) {
        const err = new Error((dados && dados.error) || ("Erro " + r.status));
        err.status = r.status;
        throw err;
    }
    return dados || {};
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const idParam = urlParams.get('id');
        const idsParam = urlParams.get('ids');
        
        let idsToLoad = [];
        if (idsParam) {
            idsToLoad = idsParam.split(',').map(id => id.trim()).filter(id => id);
        } else if (idParam) {
            idsToLoad = [idParam];
        }
        
        if (idsToLoad.length === 0) {
            showError("ID(s) da vistoria não fornecido(s) na URL.");
            return;
        }
        
        // Carregar todas as vistorias (o servidor devolve só os campos que a página usa)
        loadedVistorias = [];
        try {
            const r = await fetch(API_VISTORIA + '?ids=' + encodeURIComponent(idsToLoad.join(',')), { cache: 'no-store' });
            const dados = await lerRespostaApi(r);
            loadedVistorias = Array.isArray(dados.vistorias) ? dados.vistorias : [];
        } catch (e) {
            if (e.status !== 404) throw e;
        }
        
        if (loadedVistorias.length === 0) {
            showError("Nenhuma vistoria encontrada.");
            return;
        }
        
        document.getElementById('card-loading').style.display = 'none';
        
        // Se houver mais de um, mostrar a lista
        if (loadedVistorias.length > 1) {
            renderizarLista();
        } else {
            // Se houver apenas 1, abrir direto
            abrirVistoria(loadedVistorias[0].id);
        }
        
        // Botão voltar
        document.getElementById('btn-voltar').addEventListener('click', () => {
            if (watchId) navigator.geolocation.clearWatch(watchId);
            document.getElementById('card-content').style.display = 'none';
            document.getElementById('card-list').style.display = 'block';
        });
        
        document.getElementById('btn-voltar-sucesso').addEventListener('click', () => {
            document.getElementById('card-sucesso').style.display = 'none';
            // Atualizar status localmente e voltar para a lista
            if (currentVistoriaDoc) {
                currentVistoriaDoc.status = 'aguardando_validacao';
            }
            renderizarLista();
        });
        
    } catch (e) {
        console.error(e);
        showError("Erro ao carregar os dados: " + e.message);
    }
});

function renderizarLista() {
    const container = document.getElementById('lots-list-container');
    container.innerHTML = '';
    
    // Ordenar para agrupar visualmente
    loadedVistorias.sort((a, b) => (a.cidade || "").localeCompare(b.cidade || "") || (a.empreendimento || "").localeCompare(b.empreendimento || ""));
    
    loadedVistorias.forEach(v => {
        const item = document.createElement('div');
        item.style.padding = "15px";
        item.style.marginBottom = "10px";
        item.style.borderRadius = "8px";
        item.style.border = "1px solid #e2e8f0";
        item.style.cursor = "pointer";
        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.alignItems = "center";
        
        let statusBadge = '';
        if (v.status === 'concluida' || v.status === 'aguardando_validacao') {
            item.style.background = "#f1f5f9";
            item.style.opacity = "0.7";
            statusBadge = `<span style="background: #22c55e; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Enviado</span>`;
        } else {
            item.style.background = "#ffffff";
            statusBadge = `<span style="background: #f59e0b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Pendente</span>`;
        }
        
        item.innerHTML = `
            <div>
                <div style="font-weight: bold; margin-bottom: 4px;">${v.cidade || '-'} - ${v.empreendimento || '-'}</div>
                <div style="color: #64748b; font-size: 0.9rem;">Unidade: ${formatVistoriaUnidade(v)}</div>
            </div>
            <div>${statusBadge}</div>
        `;
        
        item.addEventListener('click', () => {
            if (v.status === 'concluida' || v.status === 'aguardando_validacao') {
                alert("Esta vistoria já foi enviada!");
                return;
            }
            abrirVistoria(v.id);
        });
        
        container.appendChild(item);
    });
    
    document.getElementById('card-list').style.display = 'block';
}

async function abrirVistoria(id) {
    currentVistoriaId = id;
    currentVistoriaDoc = loadedVistorias.find(v => v.id === id);
    
    if (!currentVistoriaDoc) return;
    
    document.getElementById('card-list').style.display = 'none';
    document.getElementById('card-content').style.display = 'block';
    
    // Configura botões de voltar
    if (loadedVistorias.length > 1) {
        document.getElementById('btn-voltar').style.display = 'block';
        document.getElementById('btn-voltar-sucesso').style.display = 'inline-block';
        document.getElementById('msg-fechar').style.display = 'none';
    } else {
        document.getElementById('btn-voltar').style.display = 'none';
        document.getElementById('btn-voltar-sucesso').style.display = 'none';
        document.getElementById('msg-fechar').style.display = 'block';
    }
    
    if (currentVistoriaDoc.status === 'concluida' || currentVistoriaDoc.status === 'aguardando_validacao') {
        document.getElementById('card-content').style.display = 'none';
        document.getElementById('card-sucesso').style.display = 'block';
        return;
    }
    
    document.getElementById('lbl-cidade').textContent = currentVistoriaDoc.cidade || '-';
    document.getElementById('lbl-empreendimento').textContent = currentVistoriaDoc.empreendimento || '-';
    if (document.getElementById('lbl-unidade')) {
        document.getElementById('lbl-unidade').textContent = formatVistoriaUnidade(currentVistoriaDoc);
    }
    
    if (currentVistoriaDoc.createdAt) {
        let createdAtDate = currentVistoriaDoc.createdAt;
        if (createdAtDate.toDate) createdAtDate = createdAtDate.toDate();
        else if (typeof createdAtDate === 'string') createdAtDate = new Date(createdAtDate);
        
        const diffTime = Math.abs(new Date() - createdAtDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        document.getElementById('lbl-dias-solicitado').textContent = `Vistoria solicitada há ${diffDays} dia(s)`;
    }
    
    document.getElementById('form-area').style.display = 'block';
    
    // Resetar formulário
    document.getElementById('q-agua').value = '';
    document.getElementById('q-energia').value = '';
    document.getElementById('q-entulho').value = '';
    document.getElementById('q-acesso').value = '';
    document.getElementById('q-estagio').value = '';
    if(document.getElementById('q-obs')) document.getElementById('q-obs').value = '';
    
    // Resetar fotos
    files.file1 = null; files.file2 = null; files.file3 = null;
    document.getElementById('input-foto1').value = ""; document.getElementById('preview1').style.display = 'none';
    document.getElementById('input-foto2').value = ""; document.getElementById('preview2').style.display = 'none';
    document.getElementById('input-foto3').value = ""; document.getElementById('preview3').style.display = 'none';
    document.getElementById('btn-enviar').disabled = true;
    
    await buscarCoordenadasLote();
}

async function buscarCoordenadasLote() {
    hasKmzReference = false;
    loteCoords = null;
    try {
        setStatus("Buscando coordenadas...", "wait");
        
        // O servidor já casou a unidade com o KMZ do empreendimento (GET /api/vistoria-publica).
        const c = currentVistoriaDoc.loteCoords;
        const foundLiveCoords = (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) ? { lat: c.lat, lng: c.lng } : null;

        if (foundLiveCoords) {
            loteCoords = foundLiveCoords;
            hasKmzReference = true;
            console.log("Usando KMZ ao vivo:", loteCoords);
            window._debugCoordSource = "KMZ (Live)";
        } else {
            liberarVistoriaSemReferencia();
            return;
        }
        
        // Removed DEBUG INFO

        iniciarGPS();
        
    } catch(e) {
        console.error(e);
        liberarVistoriaSemReferencia();
    }
}

function liberarVistoriaSemReferencia() {
    hasKmzReference = false;
    loteCoords = null;
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    document.getElementById('btn-maps').style.display = 'none';
    document.getElementById('photo-area').style.display = 'block';
    document.getElementById('q-agua').disabled = false;
    document.getElementById('q-energia').disabled = false;
    document.getElementById('q-entulho').disabled = false;
    document.getElementById('q-acesso').disabled = false;
    document.getElementById('q-estagio').disabled = false;
    if (document.getElementById('q-obs')) document.getElementById('q-obs').disabled = false;
    setStatus("KMZ não localizado. Preencha a vistoria e tire as fotos normalmente.", "success");
}

function iniciarGPS() {
    if (!navigator.geolocation) {
        showError("Seu navegador não suporta GPS.");
        document.getElementById('photo-area').style.display = 'block';
        return;
    }
    
    setStatus("Aguardando sinal de GPS...", "wait");
    
    if (watchId) navigator.geolocation.clearWatch(watchId);
    
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            
            if (!hasKmzReference || !loteCoords) return;
            const dist = calcCrow(userLat, userLng, loteCoords.lat, loteCoords.lng);
            currentDistance = Math.round(dist * 1000);
            
            // Removed update debug
            
            // Salvar GPS atual globalmente para a marca d'água
            window.currentVistoriaGps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            
            if (currentDistance <= MAX_DISTANCE) {
                setStatus(`📍 Você chegou no local! (Distância real: ${formatDistance(currentDistance)})`, "success");
                document.getElementById('btn-maps').style.display = 'none';
                document.getElementById('photo-area').style.display = 'block';
                document.getElementById('q-agua').disabled = false;
                document.getElementById('q-energia').disabled = false;
                document.getElementById('q-entulho').disabled = false;
                document.getElementById('q-acesso').disabled = false;
                document.getElementById('q-estagio').disabled = false;
                if(document.getElementById('q-obs')) document.getElementById('q-obs').disabled = false;
            } else {
                setStatus(`⚠️ Você está a ${formatDistance(currentDistance)} do lote. Aproxime-se para até ${MAX_DISTANCE} m para liberar a vistoria.`, "error");
                document.getElementById('btn-maps').style.display = 'block';
                document.getElementById('photo-area').style.display = 'none';
                document.getElementById('q-agua').disabled = true;
                document.getElementById('q-energia').disabled = true;
                document.getElementById('q-entulho').disabled = true;
                document.getElementById('q-acesso').disabled = true;
                document.getElementById('q-estagio').disabled = true;
                if(document.getElementById('q-obs')) document.getElementById('q-obs').disabled = true;
            }
        },
        (err) => {
            console.error(err);
            if (err.code === 1) {
                showError("Por favor, permita o acesso à Localização (GPS) no seu navegador.");
            } else {
                showError("Erro ao obter GPS. Sinal fraco?");
            }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

function formatDistance(distanceMeters) {
    if (distanceMeters <= 999) return `${Math.round(distanceMeters)} m`;
    return `${(distanceMeters / 1000).toFixed(1).replace('.', ',')} km`;
}

// Escopo global para HTML attributes (onclick/onchange)
window.abrirMaps = function() {
    if (loteCoords) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${loteCoords.lat},${loteCoords.lng}`, '_blank');
    }
};

window.previewImage = function(input, previewId) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        
        if (file.size > 15 * 1024 * 1024) {
            alert("A imagem é muito grande (máx 15MB).");
            input.value = "";
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const imgObj = new Image();
            imgObj.onload = function() {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                
                // Redimensionar para max 1600px para evitar uploads gigantescos
                const MAX_DIMENSION = 1600;
                let width = imgObj.width;
                let height = imgObj.height;
                
                if (width > height) {
                    if (width > MAX_DIMENSION) {
                        height = Math.round(height * (MAX_DIMENSION / width));
                        width = MAX_DIMENSION;
                    }
                } else {
                    if (height > MAX_DIMENSION) {
                        width = Math.round(width * (MAX_DIMENSION / height));
                        height = MAX_DIMENSION;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(imgObj, 0, 0, width, height);
                
                // Configurar texto de marca d'água
                const dateStr = new Date().toLocaleString("pt-BR");
                const locationStr = window.currentVistoriaGps ? 
                    `Lat: ${window.currentVistoriaGps.lat.toFixed(6)}, Lng: ${window.currentVistoriaGps.lng.toFixed(6)}` : 
                    "Localização Indisponível";
                
                const watermarkText = `${dateStr} | ${locationStr}`;
                
                const fontSize = Math.max(14, Math.floor(canvas.width / 40));
                ctx.font = `${fontSize}px Arial`;
                ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
                
                const textWidth = ctx.measureText(watermarkText).width;
                const padding = fontSize * 0.5;
                const x = canvas.width - textWidth - (padding * 2) - 10;
                const y = canvas.height - fontSize - (padding * 2) - 10;
                
                // Fundo semi-transparente
                ctx.fillRect(x, y, textWidth + (padding * 2), fontSize + (padding * 2));
                
                // Texto branco
                ctx.fillStyle = "white";
                ctx.textBaseline = "top";
                ctx.fillText(watermarkText, x + padding, y + padding);
                
                canvas.toBlob((blob) => {
                    const newFile = new File([blob], file.name, { type: 'image/jpeg' });
                    if (previewId === 'preview1') files.file1 = newFile;
                    if (previewId === 'preview2') files.file2 = newFile;
                    if (previewId === 'preview3') files.file3 = newFile;
                    
                    const imgPreview = document.getElementById(previewId);
                    imgPreview.src = URL.createObjectURL(newFile);
                    imgPreview.style.display = 'block';
                    window.verificarFormulario();
                }, 'image/jpeg', 0.85);
            };
            imgObj.src = e.target.result;
        }
        reader.readAsDataURL(file);
    }
};

window.verificarFormulario = function() {
    const qAgua = document.getElementById('q-agua').value;
    const qEnergia = document.getElementById('q-energia').value;
    const qEntulho = document.getElementById('q-entulho').value;
    const qAcesso = document.getElementById('q-acesso').value;
    const qEstagio = document.getElementById('q-estagio').value;
    
    // Verifica obrigatoriedade de fotos 2 e 3
    let fotosOpcionais = false;
    if (qAcesso === 'nao' || qEstagio === 'casa_pronta_sem_acabamento' || qEstagio === 'casa_pronta_com_morador' || qEstagio === 'apenas_muro') {
        fotosOpcionais = true;
    }
    
    // Atualizar UI das fotos
    const block2 = document.getElementById('block-foto2');
    const block3 = document.getElementById('block-foto3');
    const btnMais = document.getElementById('btn-mais-fotos');
    
    if (fotosOpcionais) {
        if (!window.fotosReveladas) {
            block2.style.display = 'none';
            block3.style.display = 'none';
            btnMais.style.display = 'inline-block';
            // Se as escondeu, pode limpar as fotos se o usuario tinha selecionado
            // Mas não vamos limpar para não perder se ele só mudou o select sem querer
        } else {
            block2.style.display = 'block';
            block3.style.display = 'block';
            btnMais.style.display = 'none';
        }
    } else {
        block2.style.display = 'block';
        block3.style.display = 'block';
        btnMais.style.display = 'none';
        window.fotosReveladas = false;
    }
    
    // Validação de preenchimento
    const formCompleto = (qAgua && qEnergia && qEntulho && qAcesso && qEstagio);
    
    // Validação de fotos
    let fotosCompletas = false;
    if (fotosOpcionais) {
        fotosCompletas = !!files.file1; // Apenas a 1 é obrigatória
    } else {
        fotosCompletas = (files.file1 && files.file2 && files.file3);
    }
    
    if (formCompleto && fotosCompletas) {
        document.getElementById('btn-enviar').disabled = false;
    } else {
        document.getElementById('btn-enviar').disabled = true;
    }
};

window.revelarMaisFotos = function() {
    window.fotosReveladas = true;
    document.getElementById('block-foto2').style.display = 'block';
    document.getElementById('block-foto3').style.display = 'block';
    document.getElementById('btn-mais-fotos').style.display = 'none';
    window.verificarFormulario();
};

window.enviarVistoria = async function() {
    const btn = document.getElementById('btn-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando... (Aguarde)';
    
    try {
        await waitForFirebase();
        const { ref, uploadBytes } = window.firebaseCollections;

        // Guarda o caminho do objeto no Storage (o banco grava o caminho, não a URL)
        let url1 = null, url2 = null, url3 = null;

        const uploadWithTimeout = (ref, file, timeoutMs = 60000) => {
            return Promise.race([
                uploadBytes(ref, file),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Tempo limite de upload excedido (CORS ou Falha de Rede). O arquivo pode ser muito grande ou a internet está lenta.")), timeoutMs))
            ]);
        };

        // Upload 1
        if (files.file1) {
            const ref1 = ref(window.firebaseStorage, `vistorias/${currentVistoriaId}/frente_${Date.now()}.jpeg`);
            await uploadWithTimeout(ref1, files.file1);
            url1 = ref1.fullPath;
        }
        
        // Upload 2
        if (files.file2) {
            const ref2 = ref(window.firebaseStorage, `vistorias/${currentVistoriaId}/meio_fundo_${Date.now()}.jpeg`);
            await uploadWithTimeout(ref2, files.file2);
            url2 = ref2.fullPath;
        }
        
        // Upload 3
        if (files.file3) {
            const ref3 = ref(window.firebaseStorage, `vistorias/${currentVistoriaId}/fundo_frente_${Date.now()}.jpeg`);
            await uploadWithTimeout(ref3, files.file3);
            url3 = ref3.fullPath;
        }
        
        const respostas = {
            possuiAgua: document.getElementById('q-agua').value,
            possuiEnergia: document.getElementById('q-energia').value,
            possuiEntulho: document.getElementById('q-entulho').value,
            permiteAcesso: document.getElementById('q-acesso').value,
            estagioObra: document.getElementById('q-estagio').value,
            observacoes: document.getElementById('q-obs') ? document.getElementById('q-obs').value : ""
        };
        
        // Grava no banco pelo servidor (confere a vistoria e chama enviar_vistoria)
        const resp = await fetch(API_VISTORIA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentVistoriaId,
                respostas,
                fotoFrente: url1,
                fotoMeioFundo: url2,
                fotoFundoFrente: url3
            })
        });
        await lerRespostaApi(resp);
        if (currentVistoriaDoc) currentVistoriaDoc.status = 'aguardando_validacao';
        
        if (watchId) navigator.geolocation.clearWatch(watchId);
        
        document.getElementById('card-content').style.display = 'none';
        document.getElementById('card-sucesso').style.display = 'block';
        
    } catch(e) {
        console.error(e);
        alert("Erro ao enviar: " + e.message);
        btn.disabled = false;
        btn.textContent = 'Tentar Novamente';
    }
};

function setStatus(msg, type) {
    const el = document.getElementById('status-container');
    el.style.display = 'block';
    el.textContent = msg;
    el.className = 'status-box';
    if (type === 'error') el.classList.add('status-error');
    if (type === 'success') el.classList.add('status-success');
}

function showError(msg) {
    document.getElementById('card-loading').style.display = 'none';
    const content = document.getElementById('card-content');
    content.style.display = 'block';
    setStatus(msg, "error");
}

function calcCrow(lat1, lon1, lat2, lon2) {
    var R = 6371; // km
    var dLat = toRad(lat2-lat1);
    var dLon = toRad(lon2-lon1);
    var lat1 = toRad(lat1);
    var lat2 = toRad(lat2);

    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    var d = R * c;
    return d;
}
function toRad(Value) {
    return Value * Math.PI / 180;
}

// Aberta pelo app de vistoria (?app=1): "Voltar" leva para a lista do app.
// Aberta pelo link do WhatsApp (sem ?app=1), nada muda.
(function () {
    if (new URLSearchParams(window.location.search).get('app') !== '1') return;
    const irParaApp = (ev) => {
        if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }
        if (watchId) navigator.geolocation.clearWatch(watchId);
        window.location.href = '/vistoria-app/';
    };
    document.addEventListener('DOMContentLoaded', () => {
        const voltar = document.getElementById('btn-voltar');
        if (voltar) voltar.addEventListener('click', irParaApp, true);
        const voltarSucesso = document.getElementById('btn-voltar-sucesso');
        if (voltarSucesso) {
            voltarSucesso.style.display = 'inline-block';
            voltarSucesso.textContent = 'Voltar para minhas vistorias';
            voltarSucesso.addEventListener('click', irParaApp, true);
        }
        const fechar = document.getElementById('msg-fechar');
        if (fechar) fechar.style.display = 'none';
    });
})();
