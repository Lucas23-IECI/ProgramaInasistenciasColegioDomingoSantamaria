import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../config";
import { useFeedback } from "../../context/FeedbackContext";
import { getApiErrorMessage } from "../../utils/apiError";

const blankPreregistration = () => ({
  visitante: { tipo_documento: "RUT", documento: "", nombre_completo: "", telefono: "" },
  motivo_codigo: "",
  destino_codigo: "",
  persona_contactada: "",
  categoria: "VISITA",
  entidad_externa_id: "",
  valida_desde: "",
  valida_hasta: "",
  usos_maximos: 1,
});

const initialData = {
  summary: {}, preregistrations: [], overdue: [], frequent: [], restrictions: [],
  deliveries: [], vehicles: [], entities: [], emergency: null, points: [],
};

export default function useVisitsExtendedOperations({ permissions }) {
  const { notify, confirm } = useFeedback();
  const [section, setSection] = useState("resumen");
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blankPreregistration());
  const [credential, setCredential] = useState(null);
  const [qrToken, setQrToken] = useState("");
  const [qrResult, setQrResult] = useState(null);
  const [delivery, setDelivery] = useState({ remitente: "", destinatario: "", descripcion: "" });
  const [vehicle, setVehicle] = useState({ patente: "", tipo: "AUTOMOVIL", marca: "", modelo: "", color: "" });
  const [vehicleLink, setVehicleLink] = useState({ visita_id: "", vehiculo_id: "" });
  const [entity, setEntity] = useState({ tipo: "PROVEEDOR", nombre: "", identificador: "" });
  const [visitorQuery, setVisitorQuery] = useState("");
  const [visitorResults, setVisitorResults] = useState([]);
  const [restriction, setRestriction] = useState({ visitante: null, tipo: "REQUIERE_AUTORIZACION", motivo: "", vigente_hasta: "" });
  const [point, setPoint] = useState({ codigo: "", nombre: "", descripcion: "" });
  const [emergency, setEmergency] = useState({ tipo: "SIMULACRO", descripcion: "", punto_reunion_id: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const calls = [axios.get(`${API_URL}/visitas/operacion-ampliada/resumen`)];
      const keys = ["summary"];
      const add = (allowed, key, url) => { if (allowed) { calls.push(axios.get(url)); keys.push(key); } };
      add(permissions.prereg, "preregistrations", `${API_URL}/visitas/preinscripciones`);
      add(permissions.view, "overdue", `${API_URL}/visitas/permanencias-excedidas`);
      add(permissions.view || permissions.settings, "frequent", `${API_URL}/visitas/visitantes-frecuentes`);
      add(permissions.restrictions, "restrictions", `${API_URL}/visitas/restricciones-acceso`);
      add(permissions.deliveries, "deliveries", `${API_URL}/visitas/encomiendas`);
      add(permissions.vehicles, "vehicles", `${API_URL}/visitas/vehiculos`);
      add(permissions.prereg || permissions.vehicles || permissions.settings, "entities", `${API_URL}/visitas/entidades-externas`);
      add(permissions.emergency, "emergency", `${API_URL}/visitas/emergencias/actual`);
      add(permissions.emergency, "points", `${API_URL}/visitas/puntos-reunion`);
      const results = await Promise.all(calls);
      setData((current) => results.reduce((next, response, index) => ({ ...next, [keys[index]]: response.data }), { ...current }));
    } catch (error) {
      notify(getApiErrorMessage(error, "No fue posible cargar la operación ampliada."), "error");
    } finally { setLoading(false); }
  }, [notify, permissions]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (visitorQuery.trim().length < 2 || !permissions.restrictions) return setVisitorResults([]);
      try {
        const response = await axios.get(`${API_URL}/visitas/visitantes-operativos`, { params: { q: visitorQuery.trim() } });
        setVisitorResults(response.data || []);
      } catch (error) {
        setVisitorResults([]);
        notify(getApiErrorMessage(error, "No fue posible buscar personas."), "error");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [notify, permissions.restrictions, visitorQuery]);

  const run = async (request, success, reset) => {
    setSaving(true);
    try {
      const response = await request(); notify(success, "success"); reset?.(response.data); await load(); return response.data;
    } catch (error) {
      notify(getApiErrorMessage(error, "No fue posible completar la operación."), "error"); return null;
    } finally { setSaving(false); }
  };
  const createPreregistration = () => {
    const dateFields = document.querySelectorAll('.extended-operations input[type="datetime-local"]');
    const payload = { ...form, valida_desde: dateFields[0]?.value || form.valida_desde, valida_hasta: dateFields[1]?.value || form.valida_hasta };
    return run(() => axios.post(`${API_URL}/visitas/preinscripciones`, payload), "Credencial temporal creada con trazabilidad.", (result) => {
      setCredential({ ...result, nombre: payload.visitante.nombre_completo, anfitrion: payload.persona_contactada });
      setForm(blankPreregistration());
    });
  };
  const validateQr = async () => {
    setSaving(true);
    try { setQrResult((await axios.post(`${API_URL}/visitas/preinscripciones/validar`, { token: qrToken })).data); }
    catch (error) { setQrResult(null); notify(getApiErrorMessage(error, "No fue posible validar el código."), "error"); }
    finally { setSaving(false); }
  };
  const useQr = () => run(() => axios.post(`${API_URL}/visitas/preinscripciones/ingresar`, { token: qrToken }), "Entrada registrada desde la credencial temporal.", () => { setQrToken(""); setQrResult(null); });
  const saveDelivery = () => run(() => axios.post(`${API_URL}/visitas/encomiendas`, delivery), "Encomienda recibida con trazabilidad.", () => setDelivery({ remitente: "", destinatario: "", descripcion: "" }));
  const saveVehicle = () => run(() => axios.post(`${API_URL}/visitas/vehiculos`, vehicle), "Vehículo incorporado al directorio.", () => setVehicle({ patente: "", tipo: "AUTOMOVIL", marca: "", modelo: "", color: "" }));
  const linkVehicle = () => run(() => axios.post(`${API_URL}/visitas/${vehicleLink.visita_id}/vehiculos/${vehicleLink.vehiculo_id}`), "Vehículo vinculado al ingreso activo.", () => setVehicleLink({ visita_id: "", vehiculo_id: "" }));
  const saveEntity = () => run(() => axios.post(`${API_URL}/visitas/entidades-externas`, entity), "Entidad externa incorporada.", () => setEntity({ tipo: "PROVEEDOR", nombre: "", identificador: "" }));
  const saveRestriction = () => run(() => axios.post(`${API_URL}/visitas/restricciones-acceso`, { visitante_id: restriction.visitante?.id, tipo: restriction.tipo, motivo: restriction.motivo, vigente_hasta: restriction.vigente_hasta || null }), "Restricción de acceso registrada.", () => { setRestriction({ visitante: null, tipo: "REQUIERE_AUTORIZACION", motivo: "", vigente_hasta: "" }); setVisitorQuery(""); });
  const updateVisitor = (visitor, frequent) => run(() => axios.patch(`${API_URL}/visitas/visitantes/${visitor.id}/operacion`, { frecuente: frequent }), frequent ? "Persona marcada como frecuente." : "Marca de persona frecuente retirada.");
  const cancelPreregistration = async (item) => {
    const accepted = await confirm({ title: "Cancelar visita esperada", message: `La credencial de ${item.nombre_completo} dejará de ser utilizable y la decisión quedará auditada.`, confirmLabel: "Cancelar credencial" });
    if (accepted) run(() => axios.patch(`${API_URL}/visitas/preinscripciones/${item.id}/cancelar`), "Visita esperada cancelada.");
  };

  return { section, setSection, data, loading, saving, form, setForm, credential, setCredential,
    qrToken, setQrToken, qrResult, setQrResult, delivery, setDelivery, vehicle, setVehicle, vehicleLink, setVehicleLink,
    entity, setEntity, visitorQuery, setVisitorQuery, visitorResults, setVisitorResults, restriction, setRestriction,
    point, setPoint, emergency, setEmergency, load, run, createPreregistration, validateQr, useQr,
    saveDelivery, saveVehicle, linkVehicle, saveEntity, saveRestriction, updateVisitor, cancelPreregistration };
}
