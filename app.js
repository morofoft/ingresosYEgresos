import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, collectionGroup, getDocs, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let miGraficaTendencia = null;
const firebaseConfig = {
    apiKey: "AIzaSyCFMgxlQfbv9I0iag7DPVZFOE2y5w0h2L4",
    authDomain: "mycash-4ff56.firebaseapp.com",
    projectId: "mycash-4ff56",
    storageBucket: "mycash-4ff56.firebasestorage.app",
    messagingSenderId: "747131683828",
    appId: "1:747131683828:web:caa509d5e12b748ba82fa1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- CONFIGURACIÓN ADMIN ---
const ADMIN_UID = "gmxIdkUYJYY3P7rVN0aC6VTnBeb2"; // Reemplaza esto con tu UID de la consola
let userUID = null;
let miGrafica = null;

// --- 1. LÓGICA DE INICIO (AQUÍ CORREGIMOS EL ERROR) ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        userUID = user.uid;
        // Mostrar panel si es admin
        if (userUID === ADMIN_UID) {
            document.getElementById('adminPanel').classList.remove('hidden');
        }
        escucharTransacciones(); // Ahora sí está definida abajo
    } else {
        window.location.href = "login.html";
    }
});

// --- 2. CALCULADORA Y GUARDADO ---
const calcularMonto = (valor) => {
    try {
        // Resuelve operaciones básicas como 100+200
        return Function(`'use strict'; return (${valor.replace(/[^-()\d/*+.]/g, '')})`)();
    } catch (e) {
        return parseFloat(valor) || 0;
    }
};

document.getElementById('btnOpenModal').onclick = async () => {
    const { value: f } = await Swal.fire({
        title: 'Nuevo Movimiento',
        background: '#1f2937', color: '#fff',
        confirmButtonColor: '#10b981',
        html: `
            <input id="swal-amount" placeholder="Monto (ej: 500+200)" class="swal2-input">
            <input id="swal-desc" type="text" placeholder="Descripción" class="swal2-input">
            <select id="swal-type" class="swal2-input bg-gray-700 !m-0 text-black">
                <option value="egreso">Egreso (-)</option>
                <option value="ingreso">Ingreso (+)</option>
            </select>
            <select id="swal-acc" class="swal2-input bg-gray-700 !m-0 text-black">
                <option value="Efectivo">Efectivo</option>
                <option value="Banco">Banco</option>
                <option value="Ahorros">Ahorros</option>
            </select>
            <select id="swal-cat" class="swal2-input !m-0 text-black bg-gray-700">
                <option value="Comida">Comida</option>
                <option value="Transporte">Transporte</option>
                <option value="Renta">Renta</option>
                <option value="Ocio">Ocio</option>
                <option value="Sueldo">Sueldo</option>
                <option value="Daneirys">Mi amor bello</option>
                <option value="Otros">Otros</option>
            </select>
        `,
        preConfirm: () => ({
            montoBruto: document.getElementById('swal-amount').value,
            desc: document.getElementById('swal-desc').value,
            tipo: document.getElementById('swal-type').value,
            cuenta: document.getElementById('swal-acc').value,
            cat: document.getElementById('swal-cat').value
        })
    });

    if (f && f.montoBruto) {
        const montoFinal = calcularMonto(f.montoBruto);

        // 1. Guardar el movimiento original (el que llenaste en el modal)
        await addDoc(collection(db, "usuarios", userUID, "transacciones"), {
            desc: f.desc,
            tipo: f.tipo,
            cuenta: f.cuenta,
            cat: f.cat,
            monto: montoFinal,
            usuarioId: userUID,
            usuarioNombre: auth.currentUser.displayName || "Usuario Anónimo",
            fecha: serverTimestamp()
        });

        console.log(f)

        // 2. Lógica Especial: Si mandas dinero a "Ahorros" desde el modal
        // y seleccionaste que la cuenta destino es Ahorros...
        if (f.cuenta === "Ahorros" && f.tipo === "ingreso") {

            // Generamos un egreso automático en "Efectivo" para balancear
            await addDoc(collection(db, "usuarios", userUID, "transacciones"), {
                desc: `Traspaso a Ahorro: ${f.desc}`,
                tipo: "egreso",
                cuenta: "Efectivo", // Sale de aquí
                cat: "Ahorros",
                monto: montoFinal,
                usuarioId: userUID,
                usuarioNombre: auth.currentUser.displayName || "Usuario Anónimo",
                fecha: serverTimestamp()
            });

            Swal.fire({
                title: '¡Ahorro registrado!',
                text: `Se restaron RD$ ${montoFinal} de tu Efectivo automáticamente.`,
                icon: 'info',
                background: '#1f2937',
                color: '#fff'
            });
        }
    }
};

// --- 3. ESCUCHAR TRANSACCIONES EN TIEMPO REAL ---
function escucharTransacciones() {
    const q = query(collection(db, "usuarios", userUID, "transacciones"), orderBy("fecha", "desc"));

    onSnapshot(q, (snapshot) => {
        let total = 0, ing = 0, egr = 0;
        let cuentas = { Efectivo: 0, Banco: 0, Ahorros: 0 };
        let catsEgresos = {};
        const lista = document.getElementById('transactionList');
        lista.innerHTML = "";
        let gastosPorDia = {};

        snapshot.forEach(docSnap => {
            const t = docSnap.data();
            const id = docSnap.id;

            // Totales e Ingresos/Egresos
            if (t.tipo === 'ingreso') {
                ing += t.monto;
                cuentas[t.cuenta] += t.monto;
            } else {
                egr += t.monto;
                cuentas[t.cuenta] -= t.monto;
                catsEgresos[t.cat] = (catsEgresos[t.cat] || 0) + t.monto;
            }

            if (t.tipo === 'egreso' && t.fecha) {
                // Convertimos el timestamp de Firebase a una fecha legible (YYYY-MM-DD)
                const fechaKey = t.fecha.toDate().toISOString().split('T')[0];
                gastosPorDia[fechaKey] = (gastosPorDia[fechaKey] || 0) + t.monto;
            }

            
            actualizarGraficaTendencia(gastosPorDia);

            // Renderizado de lista
            lista.innerHTML += `
                <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl flex justify-between items-center border border-gray-100 dark:border-gray-700 shadow-sm transition-all active:scale-95">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center ${t.tipo === 'ingreso' ? 'text-emerald-500' : 'text-rose-500'}">
                            <i class="fas ${t.tipo === 'ingreso' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                        </div>
                        <div>
                            <p class="font-bold text-sm text-gray-800 dark:text-gray-100">${t.desc || 'Sin descripción'}</p>
                            <p class="text-[9px] text-gray-400 uppercase font-bold tracking-tighter">${t.cuenta} • ${t.cat}</p>
                        </div>
                    </div>
                    <div class="text-right flex items-center gap-3">
                        <p class="font-black ${t.tipo === 'ingreso' ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-200'}">
                            ${t.tipo === 'ingreso' ? '+' : '-'}RD$ ${t.monto.toLocaleString()}
                        </p>
                        <button onclick="eliminarMovimiento('${id}')" class="text-gray-300 hover:text-rose-500 transition-colors">
                            <i class="fas fa-times-circle"></i>
                        </button>
                    </div>
                </div>`;
        });

        // Actualizar UI
        document.getElementById('totalBalance').innerText = (ing - egr).toLocaleString();
        document.getElementById('bal-efectivo').innerText = `RD$ ${cuentas.Efectivo.toLocaleString()}`;
        document.getElementById('bal-banco').innerText = `RD$ ${cuentas.Banco.toLocaleString()}`;
        document.getElementById('bal-ahorros').innerText = `RD$ ${cuentas.Ahorros.toLocaleString()}`;

        actualizarGrafica(catsEgresos);
    });

}

// --- 4. FUNCIONES GLOBALES (ELIMINAR Y ADMIN) ---
window.eliminarMovimiento = async (id) => {
    const res = await Swal.fire({
        title: '¿Borrar registro?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#f43f5e',
        cancelButtonText: 'No',
        confirmButtonText: 'Sí, borrar'
    });
    if (res.isConfirmed) {
        await deleteDoc(doc(db, "usuarios", userUID, "transacciones", id));
    }
};

window.verTodoComoAdmin = async () => {
    if (userUID !== ADMIN_UID) return;

    Swal.fire({ 
        title: 'Generando Reporte...', 
        didOpen: () => Swal.showLoading(),
        background: '#111827', color: '#fff'
    });
    
    try {
        // Obtenemos el Snapshot del grupo de colecciones
        const querySnapshot = await getDocs(collectionGroup(db, 'transacciones'));
        
        let totalIngresos = 0;
        let totalEgresos = 0;
        let filas = "";

        // IMPORTANTE: Asegúrate de que el parámetro se llame 'doc' (o similar)
        querySnapshot.forEach((doc) => {
            // Extraemos los datos correctamente
            const d = doc.data(); 
            const esIngreso = d.tipo === 'ingreso';
            const nombreUsuario = d.usuarioNombre || "Usuario Antiguo";
            
            if (esIngreso) totalIngresos += d.monto;
            else totalEgresos += d.monto;

            filas += `
                <tr class="border-b border-gray-700 hover:bg-gray-800 transition-colors">
                    <td class="p-2">
                        <div class="text-[10px] font-bold text-amber-500 truncate w-20">${nombreUsuario}</div>
                    </td>
                    <td class="p-2 text-left">
                        <div class="text-sm font-bold text-gray-200">${d.desc || 'Sin título'}</div>
                        <div class="text-[9px] text-gray-500 uppercase">${d.cat || 'General'}</div>
                    </td>
                    <td class="p-2 text-right font-black ${esIngreso ? 'text-emerald-400' : 'text-rose-400'}">
                        ${esIngreso ? '+' : '-'}RD$ ${d.monto.toLocaleString()}
                    </td>
                </tr>
            `;
        });

        const resumenHTML = `
            <div class="text-left bg-gray-900 p-2 rounded-xl border border-gray-700">
                <div class="grid grid-cols-2 gap-2 mb-4">
                    <div class="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20 text-center">
                        <p class="text-[8px] uppercase text-emerald-500 font-bold">Ingresos</p>
                        <p class="text-sm font-black text-emerald-400">RD$ ${totalIngresos.toLocaleString()}</p>
                    </div>
                    <div class="bg-rose-500/10 p-2 rounded-lg border border-rose-500/20 text-center">
                        <p class="text-[8px] uppercase text-rose-500 font-bold">Egresos</p>
                        <p class="text-sm font-black text-rose-400">RD$ ${totalEgresos.toLocaleString()}</p>
                    </div>
                </div>
                <div class="max-h-[350px] overflow-y-auto pr-1">
                    <table class="w-full text-xs">
                        <tbody id="tablaAdminCuerpo">${filas || '<tr><td colspan="3" class="text-center p-4">No hay datos</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        `;

        Swal.fire({
            title: '<span class="text-amber-500 text-lg font-black">PANEL GLOBAL</span>',
            html: resumenHTML,
            width: '95%',
            background: '#111827',
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#374151'
        });

    } catch (e) {
        console.error("Error en reporte:", e);
        Swal.fire('Error', 'No se pudo leer la base de datos. ¿Creaste el índice?', 'error');
    }
};

function actualizarGrafica(dataCats) {
    const ctx = document.getElementById('expensesChart');
    if (miGrafica) miGrafica.destroy();
    miGrafica = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(dataCats),
            datasets: [{
                data: Object.values(dataCats),
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e', '#8b5cf6', '#94a3b8'],
                hoverOffset: 20,
                borderWidth: 4,
                borderColor: document.documentElement.classList.contains('dark') ? '#1f2937' : '#fff'
            }]
        },
        options: {
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10, weight: 'bold' }, padding: 20 } } },
            cutout: '75%'
        }
    });
}

document.getElementById('btnLogout').onclick = () => signOut(auth);

// --- LÓGICA DE LA CALCULADORA FLOTANTE ---
let expresion = "";
const display = document.getElementById('calc-display');

window.calcIn = (val) => {
    if (val === 'C') {
        expresion = "";
    } else if (val === 'DEL') {
        expresion = expresion.slice(0, -1);
    } else {
        expresion += val;
    }
    display.innerText = expresion || "0";
};

// Abrir el modal y actualizar el balance rápido
document.getElementById('btnFabCalc').onclick = () => {
    const totalActual = document.getElementById('totalBalance').innerText;
    document.getElementById('calc-total-balance').innerText = totalActual;
    document.getElementById('modalCalc').classList.remove('hidden');
};

// Botón "LISTO": Pasa el monto al modal de registro
document.getElementById('btnUsarMonto').onclick = async () => {
    let resultado = 0;
    try {
        resultado = eval(expresion) || 0;
    } catch {
        return Swal.fire("Error", "Operación no válida", "error");
    }

    // Ocultar calculadora
    document.getElementById('modalCalc').classList.add('hidden');
    expresion = "";
    display.innerText = "0";

    // Abrir el modal de registro con el monto pre-llenado
    // Nota: Reutiliza tu función btnOpenModal.onclick pero pasando el resultado
    registrarConMonto(resultado);
};

// Función auxiliar para abrir el modal de registro con datos previos
async function registrarConMonto(montoCalculado) {
    // Aquí puedes llamar a la misma lógica de Swal.fire que ya tienes
    // pero configurando el defaultValue del input de monto
    document.getElementById('btnOpenModal').click(); 
    
    // Pequeño delay para dejar que Swal cargue y luego inyectar el valor
    setTimeout(() => {
        const inputMonto = document.getElementById('swal-amount');
        if (inputMonto) inputMonto.value = montoCalculado;
    }, 500);
}

function actualizarGraficaTendencia(datos) {
    const ctx = document.getElementById('trendChart');
    if (miGraficaTendencia) miGraficaTendencia.destroy();

    // Ordenar las fechas cronológicamente
    const fechasOrdenadas = Object.keys(datos).sort();
    const montosOrdenados = fechasOrdenadas.map(f => datos[f]);

    miGraficaTendencia = new Chart(ctx, {
        type: 'line',
        data: {
            labels: fechasOrdenadas.map(f => f.split('-')[2]), // Solo mostramos el día
            datasets: [{
                label: 'Gastos RD$',
                data: montosOrdenados,
                borderColor: '#f43f5e', // Rosa/Rojo
                backgroundColor: 'rgba(244, 63, 94, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4, // Curva suave
                pointRadius: 4,
                pointBackgroundColor: '#f43f5e'
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: 'rgba(156, 163, 175, 0.1)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                x: { 
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
}