import { Fragment, useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from "react";
import {
  AlertTriangle, ArrowDownToLine, BarChart3, CalendarDays, Check, ChevronRight, CircleDollarSign,
  ClipboardCheck, Dumbbell, FileUp, LayoutDashboard, LogOut, Menu, MessageCircle, Plus, Search,
  Settings, ShieldCheck, UserRound, Users, X,
} from "lucide-react";
import { consecutiveAbsences, currency, dueDateForMonth, getChargeStatus, monthlyChargeMessage, todayInGoiania } from "./lib/domain";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Role = "admin" | "teacher" | "student";
type Page = "Visão geral" | "Alunos" | "Turmas" | "Chamada" | "Financeiro" | "Experimentais" | "Relatórios" | "Configurações";
type Student = {
  id: string; auth_user_id?: string | null; name: string; phone: string; enrollment_code?: string | null;
  class_id?: string | null; plan: string; monthly_fee_cents: number; due_day: number;
  status: "active" | "paused" | "inactive"; pause_until?: string | null; notes?: string;
  archived_at?: string | null;
};
type ClassRow = { id: string; name: string; level: string; weekdays: number[]; starts_at: string; capacity: number; active: boolean };
type Charge = { id: string; student_id: string; competence: string; amount_cents: number; due_date: string };
type Payment = { id: string; charge_id: string; amount_cents: number; paid_at: string; method: string; reversed_at?: string | null };
type Adjustment = { id: string; charge_id: string; kind: "discount" | "waiver" | "cancel" | "reversal"; amount_cents: number; note: string; created_at: string };
type Attendance = { id: string; class_id: string; student_id: string; class_date: string; status: string };
type Experiment = { id: string; name: string; phone: string; class_id?: string | null; scheduled_for?: string | null; status: string; notes?: string; converted_student_id?: string | null };
type Makeup = { id: string; student_id: string; class_id: string; scheduled_for: string; status: string };
type Profile = { id: string; display_name: string; role: Role };
type DataSet = { students: Student[]; classes: ClassRow[]; charges: Charge[]; payments: Payment[]; adjustments: Adjustment[]; attendance: Attendance[]; experiments: Experiment[]; makeups: Makeup[]; profiles: Profile[] };

const pages: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: "Visão geral", icon: LayoutDashboard }, { name: "Alunos", icon: Users },
  { name: "Turmas", icon: CalendarDays }, { name: "Chamada", icon: ClipboardCheck },
  { name: "Financeiro", icon: CircleDollarSign }, { name: "Experimentais", icon: UserRound },
  { name: "Relatórios", icon: BarChart3 }, { name: "Configurações", icon: Settings },
];
const emptyData: DataSet = { students: [], classes: [], charges: [], payments: [], adjustments: [], attendance: [], experiments: [], makeups: [], profiles: [] };
const demoData: DataSet = {
  students: [
    { id: "s1", name: "Marina Costa", phone: "62991112233", enrollment_code: "RL-001", class_id: "c1", plan: "2x por semana", monthly_fee_cents: 22000, due_day: 27, status: "active" },
    { id: "s2", name: "João Pedro Alves", phone: "62992223344", enrollment_code: "RL-002", class_id: "c1", plan: "2x por semana", monthly_fee_cents: 22000, due_day: 10, status: "active" },
    { id: "s3", name: "Camila Rocha", phone: "62993334455", enrollment_code: "RL-003", class_id: "c2", plan: "1x por semana", monthly_fee_cents: 15000, due_day: 5, status: "paused", pause_until: "2026-12-01" },
  ],
  classes: [
    { id: "c1", name: "Areia 1", level: "Intermediário", weekdays: [2, 4], starts_at: "18:00", capacity: 12, active: true },
    { id: "c2", name: "Areia 2", level: "Iniciante", weekdays: [1, 3, 5], starts_at: "19:00", capacity: 10, active: true },
  ],
  charges: [
    { id: "ch1", student_id: "s1", competence: todayInGoiania().slice(0, 7) + "-01", amount_cents: 22000, due_date: todayInGoiania() },
    { id: "ch2", student_id: "s2", competence: todayInGoiania().slice(0, 7) + "-01", amount_cents: 22000, due_date: dueDateForMonth(Number(todayInGoiania().slice(0, 4)), Number(todayInGoiania().slice(5, 7)) - 1, 10) },
  ],
  payments: [{ id: "p1", charge_id: "ch2", amount_cents: 10000, paid_at: todayInGoiania(), method: "manual" }],
  adjustments: [],
  attendance: [],
  experiments: [{ id: "e1", name: "Lucas Martins", phone: "62994445566", class_id: "c1", scheduled_for: todayInGoiania(), status: "follow_up", notes: "Gostou da aula" }],
  makeups: [],
  profiles: [],
};
const labels: Record<string, string> = {
  paid: "Quitada", open: "Em aberto", due_soon: "Vence em até 3 dias", overdue: "Vencida",
  waived: "Isenta", cancelled: "Cancelada", active: "Ativa", paused: "Pausada", inactive: "Inativa",
  present: "Presente", absent: "Faltou", makeup: "Reposição", excused: "Falta justificada",
  scheduled: "Agendada", attended: "Compareceu", follow_up: "Aguardando retorno", converted: "Convertida", closed: "Encerrada",
};
const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const inputDate = () => todayInGoiania();
const publicAsset = (path: string) => /^https?:\/\//i.test(path)
  ? path
  : `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
const brandCover = publicAsset(import.meta.env.VITE_BRAND_COVER || "brand/roger-lima-cover.jpg");
const brandLogo = publicAsset(import.meta.env.VITE_BRAND_LOGO || "brand/roger-lima-logo.png");

function moneyInputToCents(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function chargeBalance(charge: Charge, payments: Payment[], adjustmentCents = 0) {
  const paid = payments.filter((payment) => payment.charge_id === charge.id && !payment.reversed_at)
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  return Math.max(0, charge.amount_cents - adjustmentCents - paid);
}

function financialStatus(charge: Charge, balance: number, adjustments: Adjustment[], payments: Payment[] = []) {
  const chargeAdjustments = adjustments.filter((item) => item.charge_id === charge.id);
  if (chargeAdjustments.some((item) => item.kind === "cancel")) return "cancelled";
  const paid = payments.filter((item) => item.charge_id === charge.id && !item.reversed_at).reduce((sum, item) => sum + item.amount_cents, 0);
  if (balance <= 0 && paid === 0 && chargeAdjustments.some((item) => item.kind === "waiver")) return "waived";
  return getChargeStatus(charge.due_date, balance);
}

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [page, setPage] = useState<Page>("Visão geral");
  const [data, setData] = useState<DataSet>(emptyData);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [studentStatusFilter, setStudentStatusFilter] = useState("all");
  const [studentMoneyFilter, setStudentMoneyFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [financeInitialFilter, setFinanceInitialFilter] = useState("all");
  const [experimentInitialFilter, setExperimentInitialFilter] = useState("all");
  const [absenceOnly, setAbsenceOnly] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<Charge | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [adjustmentCharge, setAdjustmentCharge] = useState<Charge | null>(null);
  const [importPreview, setImportPreview] = useState<{ backup: Record<string, unknown>; students: Record<string, unknown>[]; duplicates: string[] } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [studentFormOpen, setStudentFormOpen] = useState(false);
  const [experimentFormOpen, setExperimentFormOpen] = useState(false);
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [makeupTarget, setMakeupTarget] = useState<{ student: Student; classId: string } | null>(null);
  const [absenceLimit, setAbsenceLimit] = useState(2);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };
  const requireSupabase = () => {
    if (demo) {
      notify("Demonstração somente leitura; nenhuma alteração foi salva.");
      return false;
    }
    if (supabase) return true;
    notify("Configure o Supabase para salvar dados reais.");
    return false;
  };

  const loadData = useCallback(async (): Promise<boolean> => {
    if (demo) {
      setData(demoData);
      setRole("admin");
      setSyncState("saved");
      return true;
    }
    if (!supabase || !userId) return false;
    setLoading(true);
    setError("");
    const profileResult = await supabase.from("profiles").select("id,display_name,role").eq("id", userId).maybeSingle();
    if (profileResult.error || !profileResult.data) {
      setError(profileResult.error?.message ?? "Perfil não encontrado. Peça ao administrador para configurar seu acesso.");
      setSyncState("error");
      setLoading(false);
      return false;
    }
    const profile = profileResult.data as Profile;
    setRole(profile.role);
    const [students, classes, charges, payments, adjustments, attendance, experiments, makeups, profiles, settings] = await Promise.all([
      supabase.from("students").select("*").order("name"),
      supabase.from("classes").select("*").order("starts_at"),
      supabase.from("charges").select("*").order("competence", { ascending: false }),
      supabase.from("payments").select("*").order("paid_at", { ascending: false }),
      supabase.from("charge_adjustments").select("*").order("created_at", { ascending: false }),
      supabase.from("attendance").select("*").order("class_date", { ascending: false }),
      supabase.from("experiments").select("*").order("created_at", { ascending: false }),
      supabase.from("makeups").select("*").order("scheduled_for"),
      profile.role === "admin" ? supabase.from("profiles").select("id,display_name,role") : Promise.resolve({ data: [], error: null }),
      supabase.from("app_settings").select("key,value").eq("key", "absence_limit").maybeSingle(),
    ]);
    const failed = [students, classes, charges, payments, adjustments, attendance, experiments, makeups, profiles, settings].find((result) => result.error);
    if (failed?.error) {
      setError(`Não foi possível sincronizar os dados: ${failed.error.message}`);
      setSyncState("error");
    } else {
      setData({
        students: (students.data ?? []) as Student[], classes: (classes.data ?? []) as ClassRow[],
        charges: (charges.data ?? []) as Charge[], payments: (payments.data ?? []) as Payment[],
        adjustments: (adjustments.data ?? []) as Adjustment[],
        attendance: (attendance.data ?? []) as Attendance[], experiments: (experiments.data ?? []) as Experiment[],
        makeups: (makeups.data ?? []) as Makeup[], profiles: (profiles.data ?? []) as Profile[],
      });
      setAbsenceLimit(Number(settings.data?.value ?? 2));
      setSyncState("saved");
    }
    setLoading(false);
    return !failed?.error;
  }, [demo, userId]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: result }) => setUserId(result.session?.user.id ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (!session) { setRole(null); setData(emptyData); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    if (!userId || demo) return;
    const timer = window.setInterval(() => { void loadData(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [demo, loadData, userId]);

  const mutate = async (operation: () => Promise<{ error: { message: string } | null }>, success: string) => {
    setSyncState("saving");
    setError("");
    if (demo) {
      notify("A demonstração é somente leitura; os dados não foram salvos.");
      setSyncState("saved");
      return false;
    }
    let result: { error: { message: string } | null };
    try {
      result = await operation();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setSyncState("error");
      setError(`Não foi salvo: ${message}`);
      notify("Alteração não salva. Confira a conexão e tente novamente.");
      return false;
    }
    if (result.error) {
      setSyncState("error");
      setError(`Não foi salvo: ${result.error.message}`);
      notify("Alteração não salva. Confira a conexão e tente novamente.");
      return false;
    }
    const refreshed = await loadData();
    if (refreshed) {
      setSyncState("saved");
      notify(success);
    } else {
      notify("Alteração enviada ao banco, mas a atualização dos dados falhou. Confira o aviso.");
    }
    return true;
  };

  const activeStudents = data.students.filter((student) => !student.archived_at);
  const today = inputDate();
  const month = `${today.slice(0, 7)}-01`;
  const getStudent = (id: string) => data.students.find((student) => student.id === id);
  const adjustmentValue = (chargeId: string) => data.adjustments.filter((item) => item.charge_id === chargeId)
    .reduce((sum, item) => sum + (item.kind === "reversal" ? -item.amount_cents : item.amount_cents), 0);
  const chargeBalances = data.charges.map((charge) => ({
    charge, student: getStudent(charge.student_id),
    balance: chargeBalance(charge, data.payments, adjustmentValue(charge.id)),
    status: financialStatus(charge, chargeBalance(charge, data.payments, adjustmentValue(charge.id)), data.adjustments, data.payments),
  }));
  const currentBalance = (charge: Charge) => chargeBalance(charge, data.payments, adjustmentValue(charge.id));
  const overdueCount = chargeBalances.filter(({ status }) => status === "overdue").length;
  const dueSoonCount = chargeBalances.filter(({ status }) => status === "due_soon").length;
  const receivedThisMonth = data.payments.filter((payment) => payment.paid_at.slice(0, 7) === today.slice(0, 7) && !payment.reversed_at)
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const twoAbsences = activeStudents.filter((student) => {
    const recent = data.attendance.filter((row) => row.student_id === student.id).sort((a, b) => b.class_date.localeCompare(a.class_date));
    return consecutiveAbsences(recent.map((row) => row.status)) >= absenceLimit;
  }).length;
  const experimentsWaiting = data.experiments.filter((item) => item.status === "follow_up").length;
  const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const todaysClasses = data.classes.filter((item) => item.active && item.weekdays.includes(todayWeekday));
  const studentRecords = data.students.filter((student) => showArchived ? Boolean(student.archived_at) : !student.archived_at);
  const filteredStudents = studentRecords.filter((student) => {
    const className = data.classes.find((item) => item.id === student.class_id)?.name ?? "";
    const matchesText = `${student.name} ${student.phone} ${className}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = studentStatusFilter === "all" || student.status === studentStatusFilter;
    const hasOpenBalance = chargeBalances.some((entry) => entry.charge.student_id === student.id && entry.balance > 0);
    const matchesMoney = studentMoneyFilter === "all" || (studentMoneyFilter === "pending" ? hasOpenBalance : !hasOpenBalance);
    return matchesText && matchesStatus && matchesMoney;
  });

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(`Não foi possível entrar: ${authError.message}`);
    setLoading(false);
  };

  const logout = async () => {
    if (demo) { setDemo(false); setData(emptyData); setPage("Visão geral"); return; }
    if (supabase) await supabase.auth.signOut();
    setRole(null);
    setUserId(null);
  };

  const addStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireSupabase()) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const student = {
      name: String(form.get("name")), phone: String(form.get("phone")), class_id: String(form.get("class_id") || "") || null,
      plan: String(form.get("plan")), monthly_fee_cents: moneyInputToCents(String(form.get("fee"))),
      due_day: Number(form.get("due_day")), status: String(form.get("status")),
      notes: String(form.get("notes") ?? ""),
    };
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("students").insert(student);
      return { error: insertError };
    }, "Aluno cadastrado.");
    if (result) { setStudentFormOpen(false); formElement.reset(); }
  };

  const addClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireSupabase()) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const weekdays = form.getAll("weekdays").map(Number);
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("classes").insert({
        name: String(form.get("name")), level: String(form.get("level")), weekdays,
        starts_at: String(form.get("starts_at")), capacity: Number(form.get("capacity")),
      });
      return { error: insertError };
    }, "Turma criada.");
    if (result) { setClassFormOpen(false); formElement.reset(); }
  };

  const addExperiment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireSupabase()) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const classId = String(form.get("class_id") || "");
    const date = String(form.get("date"));
    const targetClass = data.classes.find((item) => item.id === classId);
    if (targetClass) {
      if (!targetClass.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
        setError("A turma escolhida não tem aula nessa data.");
        return;
      }
      const regular = activeStudents.filter((student) => student.class_id === classId && student.status === "active").length;
      const makeups = data.makeups.filter((item) => item.class_id === classId && item.scheduled_for === date && ["scheduled", "used"].includes(item.status)).length;
      const experiments = data.experiments.filter((item) => item.class_id === classId && item.scheduled_for?.slice(0, 10) === date && ["scheduled", "attended"].includes(item.status)).length;
      if (regular + makeups + experiments >= targetClass.capacity) {
        setError("A turma está sem vagas nessa data.");
        return;
      }
    }
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("experiments").insert({
        name: String(form.get("name")), phone: String(form.get("phone")), class_id: classId || null,
        scheduled_for: `${date}T${String(form.get("time") || "18:00")}:00-03:00`,
        status: "scheduled", notes: String(form.get("notes") || ""),
      });
      return { error: insertError };
    }, "Aula experimental agendada.");
    if (result) { setExperimentFormOpen(false); formElement.reset(); }
  };

  const scheduleMakeup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireSupabase() || !makeupTarget) return;
    const form = new FormData(event.currentTarget);
    const classId = String(form.get("class_id"));
    const date = String(form.get("scheduled_for"));
    const targetClass = data.classes.find((item) => item.id === classId);
    if (!targetClass || !targetClass.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      setError("Escolha uma data em que a turma tenha aula.");
      return;
    }
    const regular = activeStudents.filter((student) => student.class_id === classId && student.status === "active").length;
    const makeups = data.makeups.filter((item) => item.class_id === classId && item.scheduled_for === date && ["scheduled", "used"].includes(item.status)).length;
    const experiments = data.experiments.filter((item) => item.class_id === classId && item.scheduled_for?.slice(0, 10) === date && ["scheduled", "attended"].includes(item.status)).length;
    if (regular + makeups + experiments >= targetClass.capacity) {
      setError("Não há vaga disponível nessa turma e data.");
      return;
    }
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("makeups").insert({
        student_id: makeupTarget.student.id, class_id: classId, scheduled_for: date,
      });
      return { error: insertError };
    }, "Reposição agendada.");
    if (result) setMakeupTarget(null);
  };

  const updateMakeupStatus = async (makeup: Makeup, status: string) => {
    if (!requireSupabase()) return;
    await mutate(async () => {
      const { error: updateError } = await supabase!.from("makeups").update({ status }).eq("id", makeup.id);
      return { error: updateError };
    }, `Reposição ${status === "used" ? "confirmada" : "cancelada"}.`);
  };

  const updateExperimentStatus = async (experiment: Experiment, status: string) => {
    if (!requireSupabase()) return;
    await mutate(async () => {
      const { error: updateError } = await supabase!.from("experiments").update({ status }).eq("id", experiment.id);
      return { error: updateError };
    }, "Situação da experimental atualizada.");
  };

  const reversePayment = async (payment: Payment) => {
    if (payment.reversed_at || !requireSupabase()) return;
    if (!window.confirm(`Estornar ${currency(payment.amount_cents)} recebido em ${payment.paid_at}? O registro será preservado no histórico.`)) return;
    await mutate(async () => {
      const { error: updateError } = await supabase!.from("payments").update({ reversed_at: new Date().toISOString() }).eq("id", payment.id);
      return { error: updateError };
    }, "Pagamento estornado. O histórico foi preservado.");
  };

  const markAttendance = async (studentId: string, classId: string, status: string) => {
    if (!requireSupabase()) return;
    const { data: authData } = await supabase.auth.getUser();
    await mutate(async () => {
      const { error: upsertError } = await supabase!.from("attendance").upsert({
        student_id: studentId, class_id: classId, class_date: today, status, marked_by: authData.user?.id,
      }, { onConflict: "class_id,student_id,class_date" });
      return { error: upsertError };
    }, "Chamada atualizada.");
  };

  const markAllPresent = async (classId: string) => {
    if (!requireSupabase()) return;
    const { data: authData } = await supabase.auth.getUser();
    const roster = activeStudents.filter((student) => student.class_id === classId && student.status === "active");
    const marked = new Set(data.attendance.filter((row) => row.class_id === classId && row.class_date === today).map((row) => row.student_id));
    const rows = roster.filter((student) => !marked.has(student.id)).map((student) => ({
      class_id: classId, student_id: student.id, class_date: today, status: "present", marked_by: authData.user?.id,
    }));
    if (!rows.length) { notify("Todos já têm uma marcação."); return; }
    await mutate(async () => {
      const { error: upsertError } = await supabase!.from("attendance").upsert(rows, { onConflict: "class_id,student_id,class_date" });
      return { error: upsertError };
    }, "Presenças sem marcação registradas.");
  };

  const saveAbsenceLimit = async (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      setError("O limite deve ser um número inteiro entre 1 e 10.");
      return;
    }
    if (!requireSupabase()) return;
    const success = await mutate(async () => {
      const { error: saveError } = await supabase!.from("app_settings").upsert({ key: "absence_limit", value }, { onConflict: "key" });
      return { error: saveError };
    }, "Limite de faltas consecutivas atualizado.");
    if (success) setAbsenceLimit(value);
  };

  const createMonthlyCharges = async () => {
    if (!requireSupabase()) return;
    const due = chargeBalances.map(({ charge }) => `${charge.student_id}:${charge.competence}`);
    const resumes = activeStudents.filter((student) => student.status === "paused" && student.pause_until && student.pause_until <= today);
    const eligible = activeStudents.filter((student) => student.status === "active").concat(resumes);
    const rows = eligible.filter((student) => student.monthly_fee_cents > 0 && !due.includes(`${student.id}:${month}`)).map((student) => ({
      student_id: student.id, competence: month, amount_cents: student.monthly_fee_cents,
      due_date: dueDateForMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, student.due_day),
    }));
    if (!rows.length && !resumes.length) { notify("Não há mensalidades novas para gerar."); return; }
    await mutate(async () => {
      if (rows.length) {
        const { error: insertError } = await supabase!.from("charges").insert(rows);
        if (insertError) return { error: insertError };
      }
      if (resumes.length) {
        const { error: resumeError } = await supabase!.from("students").update({ status: "active", pause_until: null })
          .in("id", resumes.map((student) => student.id));
        if (resumeError) return { error: resumeError };
      }
      return { error: null };
    }, "Mensalidades do mês geradas e matrículas com pausa encerrada retomadas.");
  };

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireSupabase() || !selectedPayment) return;
    const balance = currentBalance(selectedPayment);
    const amount = moneyInputToCents(paymentAmount);
    if (amount <= 0 || amount > balance) { setError("Informe um valor maior que zero e não superior ao saldo."); return; }
    const { data: authData } = await supabase.auth.getUser();
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("payments").insert({
        charge_id: selectedPayment.id, amount_cents: amount, paid_at: today, method: "manual", received_by: authData.user?.id,
      });
      return { error: insertError };
    }, "Pagamento registrado.");
    if (result) { setSelectedPayment(null); setPaymentAmount(""); }
  };

  const applyAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireSupabase() || !adjustmentCharge) return;
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind"));
    const amount = moneyInputToCents(String(form.get("amount")));
    const balance = currentBalance(adjustmentCharge);
    if (kind === "reversal") { setError("Para estornar um recebimento, use a ação Estornar no histórico do pagamento."); return; }
    if (amount <= 0 || amount > balance || (kind === "cancel" && amount !== balance)) {
      setError(kind === "cancel" ? "Para cancelar, informe o saldo total em aberto." : "O ajuste deve ser maior que zero e não superior ao saldo.");
      return;
    }
    const { data: authData } = await supabase.auth.getUser();
    const result = await mutate(async () => {
      const { error: insertError } = await supabase!.from("charge_adjustments").insert({
        charge_id: adjustmentCharge.id, kind, amount_cents: amount,
        note: String(form.get("note") || ""), created_by: authData.user?.id,
      });
      return { error: insertError };
    }, "Ajuste registrado no histórico.");
    if (result) setAdjustmentCharge(null);
  };

  const convertExperiment = async (experiment: Experiment) => {
    if (!requireSupabase()) return;
    await mutate(async () => {
      const { error: conversionError } = await supabase!.rpc("admin_convert_experiment", { target_experiment: experiment.id });
      return { error: conversionError };
    }, "Experimental convertida sem redigitar os dados. Complete plano e mensalidade na ficha.");
  };

  const updateStudent = async (student: Student, changes: Partial<Student>, message: string) => {
    if (!requireSupabase()) return;
    await mutate(async () => {
      const { error: updateError } = await supabase!.from("students").update(changes).eq("id", student.id);
      return { error: updateError };
    }, message);
  };

  const saveStudentDetails = async (event: FormEvent<HTMLFormElement>, student: Student) => {
    event.preventDefault();
    if (!requireSupabase()) return;
    const form = new FormData(event.currentTarget);
    const changes = {
      name: String(form.get("name")), phone: String(form.get("phone")), enrollment_code: String(form.get("enrollment_code")),
      class_id: String(form.get("class_id") || "") || null, plan: String(form.get("plan")),
      monthly_fee_cents: moneyInputToCents(String(form.get("fee"))), due_day: Number(form.get("due_day")),
      status: String(form.get("status")), pause_until: String(form.get("pause_until") || "") || null,
      notes: String(form.get("notes") || ""),
    };
    const ok = await mutate(async () => {
      const { error: updateError } = await supabase!.from("students").update(changes).eq("id", student.id);
      return { error: updateError };
    }, "Ficha do aluno atualizada.");
    if (ok) setSelectedStudent(null);
  };

  const exportCsv = (startDate = `${today.slice(0, 7)}-01`, endDate = today, classId = "all") => {
    const reportBalances = chargeBalances.filter(({ charge, student }) =>
      charge.due_date >= startDate && charge.due_date <= endDate
      && (classId === "all" || student?.class_id === classId),
    );
    const reportPayments = data.payments.filter((payment) => payment.paid_at >= startDate && payment.paid_at <= endDate
      && (classId === "all" || data.students.find((student) => student.id === data.charges.find((charge) => charge.id === payment.charge_id)?.student_id)?.class_id === classId));
    const reportAttendance = data.attendance.filter((item) => item.class_date >= startDate && item.class_date <= endDate
      && (classId === "all" || item.class_id === classId));
    const reportExperiments = data.experiments.filter((item) => {
      const scheduledDate = item.scheduled_for?.slice(0, 10) ?? "";
      return scheduledDate >= startDate && scheduledDate <= endDate && (classId === "all" || item.class_id === classId);
    });
    const reportClasses = data.classes.filter((item) => classId === "all" || item.id === classId);
    const received = reportPayments.filter((item) => !item.reversed_at).reduce((sum, item) => sum + item.amount_cents, 0);
    const attendedCount = reportAttendance.filter((item) => ["present", "makeup"].includes(item.status)).length;
    const convertedCount = reportExperiments.filter((item) => item.status === "converted").length;
    const rows = [
      ["Tipo", "Aluno / Turma", "Telefone", "Data / competência", "Valor (R$)", "Saldo (R$)", "Situação / detalhe"],
      ["Resumo", "Recebido", "", `${startDate} a ${endDate}`, (received / 100).toFixed(2), "", "Pagamentos não estornados"],
      ["Resumo", "Frequência", "", `${startDate} a ${endDate}`, "", "", `${attendedCount}/${reportAttendance.length} presenças`],
      ["Resumo", "Conversão experimental", "", `${startDate} a ${endDate}`, "", "", `${convertedCount}/${reportExperiments.length}`],
      ...reportBalances.map(({ charge, student, balance, status }) => [
        "Mensalidade", student?.name ?? "Aluno arquivado", student?.phone ?? "", `${charge.competence} · vence ${charge.due_date}`,
        (charge.amount_cents / 100).toFixed(2), (balance / 100).toFixed(2), labels[status],
      ]),
      ...reportPayments.map((payment) => {
        const charge = data.charges.find((item) => item.id === payment.charge_id);
        const student = data.students.find((item) => item.id === charge?.student_id);
        return ["Pagamento", student?.name ?? "", student?.phone ?? "", payment.paid_at, (payment.amount_cents / 100).toFixed(2), "", payment.reversed_at ? "Estornado" : "Recebido"];
      }),
      ...reportAttendance.map((item) => [
        "Chamada", data.students.find((student) => student.id === item.student_id)?.name ?? "",
        data.classes.find((cls) => cls.id === item.class_id)?.name ?? "", item.class_date, "", "", labels[item.status] ?? item.status,
      ]),
      ...reportExperiments.map((item) => [
        "Experimental", item.name, data.classes.find((cls) => cls.id === item.class_id)?.name ?? "",
        item.scheduled_for?.slice(0, 10) ?? "", "", "", labels[item.status] ?? item.status,
      ]),
      ...reportClasses.map((item) => {
        const count = activeStudents.filter((student) => student.class_id === item.id && student.status === "active").length;
        return ["Ocupação", item.name, item.level, "", "", "", `${count}/${item.capacity}`];
      }),
    ];
    const csv = rows.map((row) => row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = "relatorio-mensalidades.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const inspectBackup = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (!Array.isArray(parsed.students)) throw new Error("O JSON precisa conter uma lista students.");
      const backupStudents = parsed.students as Record<string, unknown>[];
      const seenPhones = new Set<string>();
      const seenNames = new Set<string>();
      const duplicates = backupStudents.filter((item) => {
        const phone = String(item.phone ?? "").replace(/\D/g, "");
        const name = String(item.name ?? "").trim().toLowerCase();
        const duplicate = activeStudents.some((student) =>
          (phone && phone === student.phone.replace(/\D/g, "")) || name === student.name.trim().toLowerCase(),
        ) || (phone !== "" && seenPhones.has(phone)) || (name !== "" && seenNames.has(name));
        if (phone) seenPhones.add(phone);
        if (name) seenNames.add(name);
        return duplicate;
      }).map((item) => String(item.name ?? "(sem nome)"));
      setImportPreview({ backup: parsed, students: backupStudents, duplicates });
      setError("");
    } catch (reason) {
      setError(`Não foi possível ler o backup: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const importStudents = async () => {
    if (!requireSupabase() || !importPreview) return;
    const ok = await mutate(async () => {
      const { error: importError } = await supabase!.rpc("admin_import_backup", { payload: importPreview.backup });
      return { error: importError };
    }, "Backup e históricos compatíveis importados; cadastros duplicados foram associados.");
    if (ok) setImportPreview(null);
  };

  const navTo = (target: Page) => {
    setPage(target);
    setMobileMenuOpen(false);
    if (target !== "Chamada") setAbsenceOnly(false);
  };
  const todayDisplay = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  if (!userId && !demo) {
    return <LoginScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword}
      signIn={signIn} loading={loading} error={error} onDemo={() => { setDemo(true); setData(demoData); setRole("admin"); }} />;
  }

  const canManage = role === "admin";
  if (role === "student" && !demo) {
    const ownStudent = data.students.find((student) => student.auth_user_id === userId);
    return <StudentPortal student={ownStudent} data={data} onLogout={() => void logout()} />;
  }
  const nav = (
    <nav className="nav-items" aria-label="Menu principal">
      {pages.filter((item) => canManage || !["Financeiro", "Experimentais", "Configurações"].includes(item.name))
        .map(({ name, icon: Icon }) => (
          <button key={name} className={`nav-item ${page === name ? "selected" : ""}`} onClick={() => navTo(name)}>
            <Icon size={19} /><span>{name}</span>{name === page && <ChevronRight className="nav-current" size={16} />}
          </button>
        ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <img src={brandLogo} alt="Roger Lima" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <div className="brand-fallback">RL</div>
          <div><strong>ROGER LIMA</strong><small>FUTEVÔLEI · GESTÃO</small></div>
          <button className="icon-button mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu"><X size={20} /></button>
        </div>
        <div className="nav-caption">MENU PRINCIPAL</div>
        {nav}
        <div className="sidebar-bottom">
          <div className={`sync-pill ${syncState}`}><span />{syncState === "saved" ? (demo ? "Modo demonstração" : "Dados sincronizados") : syncState === "saving" ? "Salvando..." : "Não sincronizado"}</div>
          <button className="nav-item logout" onClick={() => void logout()}><LogOut size={18} /><span>Sair</span></button>
        </div>
      </aside>
      {mobileMenuOpen && <button className="scrim" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu" />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-trigger" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu"><Menu size={23} /></button>
          <div><span className="eyebrow">{todayDisplay}</span><h1>{page}</h1></div>
          <div className="topbar-right">
            {demo && <span className="demo-badge">DEMONSTRAÇÃO</span>}
            <span className={`save-status ${syncState}`}><span />{syncState === "saved" ? "Salvo" : syncState === "saving" ? "Salvando" : "Falha ao salvar"}</span>
            <div className="avatar">{(role === "admin" ? "RL" : role === "teacher" ? "PR" : "AL")}</div>
          </div>
        </header>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={18} />{error}<button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
        {loading && <div className="loading-bar" aria-label="Carregando" />}
        <div className="workspace" style={{ "--cover-image": `url("${brandCover}")` } as CSSProperties}>
          {page === "Visão geral" && <Dashboard
            data={data} today={today} classes={todaysClasses} activeStudents={activeStudents}
            canManage={canManage}
            overdueCount={overdueCount} dueSoonCount={dueSoonCount} received={receivedThisMonth}
            absenceCount={twoAbsences} experimentCount={experimentsWaiting} balances={chargeBalances}
            onNavigate={navTo} onSelectActiveStudents={() => { setStudentStatusFilter("active"); setShowArchived(false); navTo("Alunos"); }}
            onSelectFinance={(filter) => { setFinanceInitialFilter(filter); navTo("Financeiro"); }}
            onSelectExperiments={(filter) => { setExperimentInitialFilter(filter); navTo("Experimentais"); }}
            onSelectAbsences={() => { setAbsenceOnly(true); navTo("Chamada"); }}
            onSelectClass={(id) => { setAbsenceOnly(false); setSelectedClassId(id); navTo("Chamada"); }}
          />}
          {page === "Alunos" && <section className="content-section">
            <SectionHeading title="Alunos" subtitle={`${studentRecords.length} cadastros ${showArchived ? "arquivados" : "não arquivados"}`}>
              {canManage && <button className="primary-button" onClick={() => setStudentFormOpen(!studentFormOpen)}><Plus size={18} />Novo aluno</button>}
            </SectionHeading>
            {studentFormOpen && <form className="form-card form-grid" onSubmit={addStudent}>
              <Input label="Nome completo" name="name" required />
              <Input label="WhatsApp" name="phone" type="tel" required />
              <label className="field"><span>Turma</span><select name="class_id" defaultValue=""><option value="">Sem turma</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <Input label="Plano" name="plan" defaultValue="Mensal" required />
              <Input label="Mensalidade (R$)" name="fee" type="number" step="0.01" min="0" required />
              <Input label="Dia de vencimento" name="due_day" type="number" min="1" max="31" defaultValue="10" required />
              <label className="field"><span>Situação da matrícula</span><select name="status"><option value="active">Ativa</option><option value="paused">Pausada</option><option value="inactive">Inativa</option></select></label>
              <Input label="Observações internas" name="notes" />
              <div className="form-actions"><button className="primary-button" type="submit">Salvar aluno</button><button type="button" className="secondary-button" onClick={() => setStudentFormOpen(false)}>Cancelar</button></div>
            </form>}
            <div className="filter-row">
              <label className="search-field"><Search size={18} /><input placeholder="Buscar por nome, telefone ou turma" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <select value={studentStatusFilter} onChange={(event) => setStudentStatusFilter(event.target.value)} aria-label="Filtrar situação">
                <option value="all">Todas as situações</option><option value="active">Ativa</option><option value="paused">Pausada</option><option value="inactive">Inativa</option>
              </select>
              <select value={studentMoneyFilter} onChange={(event) => setStudentMoneyFilter(event.target.value)} aria-label="Filtrar pendência financeira">
                <option value="all">Toda situação financeira</option><option value="pending">Com saldo em aberto</option><option value="clear">Sem saldo em aberto</option>
              </select>
              <select value={showArchived ? "archived" : "current"} onChange={(event) => setShowArchived(event.target.value === "archived")} aria-label="Filtrar cadastros arquivados">
                <option value="current">Não arquivados</option><option value="archived">Arquivados</option>
              </select>
            </div>
            <div className="table-card"><table><thead><tr><th>Aluno</th><th>Turma / plano</th><th>Mensalidade</th><th>Matrícula</th><th>Vencimento</th><th /></tr></thead>
              <tbody>{filteredStudents.map((student) => <tr key={student.id}>
                <td><strong>{student.name}</strong><small>{student.phone || "Sem telefone"}</small></td>
                <td>{data.classes.find((item) => item.id === student.class_id)?.name ?? "Sem turma"}<small>{student.plan}</small></td>
                <td>{currency(student.monthly_fee_cents)}</td><td><StatusTag status={student.status} /></td>
                <td>Todo dia {student.due_day}{student.pause_until && <small>Retoma em {student.pause_until}</small>}</td>
                <td><div className="row-actions">
                  <button className="tiny-button" onClick={() => setSelectedStudent(student)}>Ficha</button>
                  {canManage && (student.archived_at ? <button className="tiny-button" onClick={() => void updateStudent(student, { archived_at: null }, "Cadastro restaurado.")}>Restaurar</button> : <>
                  <button className="tiny-button" onClick={() => {
                    const newStatus = student.status === "active" ? "paused" : "active";
                    const resume = newStatus === "paused" ? window.prompt("Data de retomada (AAAA-MM-DD), opcional:") : null;
                    void updateStudent(student, { status: newStatus, pause_until: resume || null }, `Matrícula ${labels[newStatus].toLowerCase()}.`);
                  }}>{student.status === "active" ? "Pausar" : "Retomar"}</button>
                  <button className="tiny-button danger-text" onClick={() => {
                    if (window.confirm(`Arquivar o cadastro de ${student.name}? O histórico financeiro será preservado.`))
                      void updateStudent(student, { archived_at: new Date().toISOString() }, "Cadastro arquivado.");
                  }}>Arquivar</button>
                </>)}</div></td>
              </tr>)}</tbody></table>
              {!filteredStudents.length && <EmptyState title="Nenhum aluno encontrado" text="Ajuste a busca ou cadastre um novo aluno." />}
            </div>
          </section>}
          {page === "Turmas" && <ClassesPage data={data} today={today} activeStudents={activeStudents} canManage={canManage}
            formOpen={classFormOpen} setFormOpen={setClassFormOpen} addClass={addClass}
            onOpenAttendance={(id) => { setSelectedClassId(id); navTo("Chamada"); }} />}
          {page === "Chamada" && <AttendancePage data={data} today={today} classes={todaysClasses} students={activeStudents} canManage={canManage} absenceLimit={absenceLimit} absenceOnly={absenceOnly} onClearAbsenceFilter={() => setAbsenceOnly(false)} onScheduleMakeup={setMakeupTarget} onMakeupStatus={updateMakeupStatus} onExperimentAttendance={updateExperimentStatus}
            selectedClassId={selectedClassId} setSelectedClassId={setSelectedClassId} mark={markAttendance}
            markAll={markAllPresent} onRefresh={() => void loadData()} />}
          {page === "Financeiro" && canManage && <FinancePage balances={chargeBalances} payments={data.payments} adjustments={data.adjustments}
            initialFilter={financeInitialFilter}
            students={activeStudents} onGenerate={createMonthlyCharges} onPayment={(charge) => {
              setSelectedPayment(charge); setPaymentAmount((currentBalance(charge) / 100).toFixed(2));
            }} onAdjust={setAdjustmentCharge} onReversePayment={reversePayment} />}
          {page === "Experimentais" && canManage && <ExperimentsPage data={data} formOpen={experimentFormOpen} initialFilter={experimentInitialFilter}
            setFormOpen={setExperimentFormOpen} addExperiment={addExperiment} onConvert={convertExperiment}
            onStatus={updateExperimentStatus} />}
          {page === "Relatórios" && <ReportsPage data={data} balances={chargeBalances} exportCsv={exportCsv} />}
          {page === "Configurações" && canManage && <SettingsPage profiles={data.profiles} inspectBackup={inspectBackup} absenceLimit={absenceLimit} onSaveAbsenceLimit={saveAbsenceLimit} />}
        </div>
      </main>
      {selectedPayment && <Dialog title="Registrar pagamento" onClose={() => setSelectedPayment(null)}>
        <form className="stack-form" onSubmit={submitPayment}>
          <p>Saldo da competência {selectedPayment.competence.slice(0, 7)}: <strong>{currency(currentBalance(selectedPayment))}</strong></p>
          <Input label="Valor recebido (R$)" name="amount" type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
          <p className="muted small">Baixa manual. Data do recebimento: {today}. Sem integração externa.</p>
          <button className="primary-button" type="submit">Confirmar recebimento</button>
        </form>
      </Dialog>}
      {adjustmentCharge && <Dialog title="Ajustar cobrança" onClose={() => setAdjustmentCharge(null)}>
        <form className="stack-form" onSubmit={applyAdjustment}>
          <label className="field"><span>Tipo de ajuste</span><select name="kind"><option value="discount">Desconto</option><option value="waiver">Isenção</option><option value="cancel">Cancelamento</option></select></label>
          <Input label="Valor (R$)" name="amount" type="number" min="0.01" step="0.01" required />
          <Input label="Motivo / observação" name="note" />
          <button className="primary-button" type="submit">Registrar ajuste</button>
        </form>
      </Dialog>}
      {selectedStudent && <StudentDetails student={selectedStudent} data={data} canEdit={canManage} onSave={saveStudentDetails} onClose={() => setSelectedStudent(null)} />}
      {makeupTarget && <Dialog title={`Agendar reposição · ${makeupTarget.student.name}`} onClose={() => setMakeupTarget(null)}>
        <form className="stack-form" onSubmit={scheduleMakeup}>
          <label className="field"><span>Turma de reposição</span><select name="class_id" defaultValue={makeupTarget.classId} required>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.level}</option>)}</select></label>
          <Input label="Data" name="scheduled_for" type="date" min={today} required />
          <button className="primary-button" type="submit">Reservar vaga</button>
        </form>
      </Dialog>}
      {importPreview && <Dialog title="Prévia da importação" onClose={() => setImportPreview(null)}>
        <p>{importPreview.students.length} alunos no arquivo · {importPreview.duplicates.length} possíveis duplicados.</p>
        <p className="muted small">{["classes", "charges", "payments", "charge_adjustments", "attendance", "makeups", "experiments"].map((key) => `${Array.isArray(importPreview.backup[key]) ? (importPreview.backup[key] as unknown[]).length : 0} ${key}`).join(" · ")}</p>
        {importPreview.duplicates.length > 0 && <p className="warning-note">Possíveis duplicados (telefone/nome): {importPreview.duplicates.join(", ")}. O banco remapeia automaticamente apenas telefones iguais; coincidências só por nome precisam de revisão antes da importação.</p>}
        <p className="muted small">Vínculos e históricos são remapeados por IDs e competência. Revise a prévia e mantenha uma cópia do banco antes de confirmar.</p>
        <button className="primary-button" onClick={() => void importStudents()}>Importar backup</button>
      </Dialog>}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function LoginScreen({ email, setEmail, password, setPassword, signIn, loading, error, onDemo }: {
  email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void;
  signIn: (event: FormEvent) => void; loading: boolean; error: string; onDemo: () => void;
}) {
  return <main className="login-screen" style={{ "--cover-image": `url("${brandCover}")` } as CSSProperties}>
    <div className="login-card">
      <div className="login-brand"><img src={brandLogo} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
        <span className="brand-fallback">RL</span><span>ROGER LIMA</span></div>
      <p className="eyebrow">GESTÃO ESPORTIVA</p><h1>Seu time.<br /><em>Em jogo.</em></h1>
      <p className="login-description">Aulas, presença e mensalidades em um só lugar.</p>
      {isSupabaseConfigured ? <form className="stack-form" onSubmit={signIn}>
        <Input label="Email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <Input label="Senha" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="login-error">{error}</p>}
        <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "Entrando..." : "Entrar na plataforma"}<ChevronRight size={18} /></button>
      </form> : <div className="setup-notice"><ShieldCheck size={20} /><span>Configure o Supabase no arquivo <code>.env.local</code> para acessar seus dados reais.</span></div>}
      <button className="demo-button" onClick={onDemo}>Explorar demonstração fictícia</button>
      <p className="login-footnote">Fuso horário: Goiânia · Acesso protegido</p>
    </div>
    <div className="login-caption">FUTEVÔLEI · GOIÂNIA</div>
  </main>;
}

function StudentPortal({ student, data, onLogout }: { student?: Student; data: DataSet; onLogout: () => void }) {
  const classRow = student?.class_id ? data.classes.find((item) => item.id === student.class_id) : undefined;
  const attendance = data.attendance.filter((item) => item.student_id === student?.id).sort((a, b) => b.class_date.localeCompare(a.class_date));
  const charges = data.charges.filter((item) => item.student_id === student?.id);
  return <main className="student-portal">
    <header className="portal-header" style={{ "--cover-image": `url("${brandCover}")` } as CSSProperties}>
      <div className="brand-lockup"><img src={brandLogo} alt="Roger Lima" onError={(event) => { event.currentTarget.style.display = "none"; }} /><div className="brand-fallback">RL</div><div><strong>ROGER LIMA</strong><small>PORTAL DO ALUNO</small></div></div>
      <button className="portal-logout" onClick={onLogout}><LogOut size={17} />Sair</button>
    </header>
    {student ? <div className="portal-content">
      <span className="eyebrow">SEU ESPAÇO</span><h1>Olá, {student.name.split(" ")[0]}!</h1>
      <p className="portal-date">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" }).format(new Date())}</p>
      <div className="portal-grid">
        <section className="panel-card"><div className="panel-heading"><div><h3><CalendarDays size={18} />Seus horários</h3><p>Turma, dias e horário das aulas</p></div></div>
          {classRow ? <div className="portal-class"><strong>{classRow.name}</strong><span>{classRow.level}</span><b>{classRow.weekdays.map((day) => dayLabels[day]).join(", ")} · {classRow.starts_at.slice(0, 5)}</b></div> : <EmptyState title="Turma não vinculada" text="Fale com o professor para confirmar seus horários." />}
        </section>
        <section className="panel-card"><div className="panel-heading"><div><h3><ClipboardCheck size={18} />Suas presenças</h3><p>Histórico de chamadas registradas</p></div></div>
          {attendance.slice(0, 8).map((item) => <div className="portal-history" key={item.id}><span>{item.class_date.split("-").reverse().join("/")}</span><StatusTag status={item.status} /></div>)}
          {!attendance.length && <EmptyState title="Sem presenças registradas" text="As chamadas aparecerão aqui após a aula." />}
        </section>
        <section className="panel-card portal-payments"><div className="panel-heading"><div><h3><CircleDollarSign size={18} />Suas mensalidades</h3><p>Competência, vencimento e pagamentos</p></div></div>
          {charges.map((charge) => {
            const adjustment = data.adjustments.filter((item) => item.charge_id === charge.id)
              .reduce((sum, item) => sum + (item.kind === "reversal" ? -item.amount_cents : item.amount_cents), 0);
            const balance = chargeBalance(charge, data.payments, adjustment);
            return <div className="portal-history" key={charge.id}><span>{charge.competence.slice(0, 7)} · vence {charge.due_date.split("-").reverse().join("/")}</span><strong>{currency(balance)}</strong><StatusTag status={financialStatus(charge, balance, data.adjustments, data.payments)} /></div>;
          })}
          {!charges.length && <EmptyState title="Sem mensalidades emitidas" text="Quando houver uma cobrança, ela aparecerá aqui." />}
        </section>
      </div>
    </div> : <div className="portal-content"><h1>Conta ainda sem matrícula vinculada</h1><p>Peça ao professor para associar seu acesso ao cadastro de aluno.</p></div>}
    <footer className="portal-footer">Seus dados são privados e visíveis apenas para sua conta.</footer>
  </main>;
}

function StudentDetails({ student, data, canEdit, onSave, onClose }: {
  student: Student; data: DataSet; canEdit: boolean; onSave: (event: FormEvent<HTMLFormElement>, student: Student) => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const attendance = data.attendance.filter((item) => item.student_id === student.id).sort((a, b) => b.class_date.localeCompare(a.class_date));
  const charges = data.charges.filter((item) => item.student_id === student.id).sort((a, b) => b.competence.localeCompare(a.competence));
  return <Dialog title="Ficha do aluno" onClose={onClose}>
    {editing ? <form className="stack-form student-edit-form" onSubmit={(event) => onSave(event, student)}>
      <Input label="Nome" name="name" defaultValue={student.name} required /><Input label="WhatsApp" name="phone" type="tel" defaultValue={student.phone} />
      <Input label="Matrícula" name="enrollment_code" defaultValue={student.enrollment_code ?? ""} />
      <label className="field"><span>Turma</span><select name="class_id" defaultValue={student.class_id ?? ""}><option value="">Sem turma</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Input label="Plano" name="plan" defaultValue={student.plan} required /><Input label="Mensalidade (R$)" name="fee" type="number" step="0.01" min="0" defaultValue={(student.monthly_fee_cents / 100).toFixed(2)} required />
      <Input label="Dia de vencimento" name="due_day" type="number" min="1" max="31" defaultValue={student.due_day} required />
      <label className="field"><span>Situação da matrícula</span><select name="status" defaultValue={student.status}><option value="active">Ativa</option><option value="paused">Pausada</option><option value="inactive">Inativa</option></select></label>
      <Input label="Retomada da cobrança (opcional)" name="pause_until" type="date" defaultValue={student.pause_until ?? ""} />
      <label className="field"><span>Observações internas</span><textarea name="notes" defaultValue={student.notes ?? ""} rows={3} /></label>
      <div className="form-actions"><button className="primary-button">Salvar ficha</button><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancelar</button></div>
    </form> : <>
    <div className="student-detail-head"><div className="student-avatar">{student.name.split(" ").map((word) => word[0]).slice(0, 2).join("")}</div><div><strong>{student.name}</strong><small>{student.phone} · Matrícula {student.enrollment_code || "—"}</small></div></div>
    <div className="detail-grid"><span>Turma<strong>{data.classes.find((item) => item.id === student.class_id)?.name ?? "Sem turma"}</strong></span>
      <span>Plano<strong>{student.plan}</strong></span><span>Mensalidade<strong>{currency(student.monthly_fee_cents)}</strong></span>
      <span>Vencimento<strong>Dia {student.due_day}</strong></span><span>Matrícula<strong>{labels[student.status]}</strong></span>
      <span>Frequência<strong>{attendance.filter((item) => ["present", "makeup"].includes(item.status)).length}/{attendance.length} presenças</strong></span></div>
    {student.notes && <div className="private-notes"><strong>Observações internas</strong><p>{student.notes}</p></div>}
    <h3 className="detail-subhead">Histórico de mensalidades</h3>
    {charges.map((charge) => {
      const balance = chargeBalance(charge, data.payments, data.adjustments.filter((item) => item.charge_id === charge.id)
        .reduce((sum, item) => sum + (item.kind === "reversal" ? -item.amount_cents : item.amount_cents), 0));
      const paid = data.payments.filter((payment) => payment.charge_id === charge.id);
      return <div className="portal-history" key={charge.id}><span>{charge.competence.slice(0, 7)} · {paid.map((item) => `${item.paid_at} ${currency(item.amount_cents)}`).join(", ") || "Sem pagamentos"}</span><strong>Saldo {currency(balance)}</strong></div>;
    })}
    {!charges.length && <p className="muted small">Nenhuma cobrança emitida.</p>}
    <h3 className="detail-subhead">Frequência recente</h3>
    {attendance.slice(0, 6).map((item) => <div className="portal-history" key={item.id}><span>{item.class_date.split("-").reverse().join("/")}</span><StatusTag status={item.status} /></div>)}
    {!attendance.length && <p className="muted small">Nenhuma chamada registrada.</p>}
    {canEdit && <button className="primary-button detail-edit-button" onClick={() => setEditing(true)}>Editar ficha</button>}
    </>}
  </Dialog>;
}

function Dashboard({ data, today, classes, activeStudents, canManage, overdueCount, dueSoonCount, received, absenceCount, experimentCount, balances, onNavigate, onSelectActiveStudents, onSelectFinance, onSelectExperiments, onSelectAbsences, onSelectClass }: {
  data: DataSet; today: string; classes: ClassRow[]; activeStudents: Student[]; canManage: boolean; overdueCount: number; dueSoonCount: number;
  received: number; absenceCount: number; experimentCount: number; balances: { charge: Charge; student?: Student; balance: number; status: string }[];
  onNavigate: (page: Page) => void; onSelectActiveStudents: () => void; onSelectFinance: (filter: string) => void;
  onSelectExperiments: (filter: string) => void; onSelectAbsences: () => void; onSelectClass: (id: string) => void;
}) {
  return <div className="dashboard">
    <section className="hero-panel"><div className="hero-copy"><span className="eyebrow">PAINEL DO PROFESSOR</span><h2>Treino bom começa<br />com organização.</h2><p>{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date())}</p></div><Dumbbell className="hero-mark" size={88} strokeWidth={1.2} /></section>
    <section className="stat-grid">
      <StatCard label="Alunos ativos" value={String(activeStudents.filter((item) => item.status === "active").length)} icon={<Users />} tone="green" onClick={onSelectActiveStudents} />
      <StatCard label="Faltas consecutivas" value={String(absenceCount)} icon={<ClipboardCheck />} tone="orange" onClick={onSelectAbsences} />
      {canManage && <>
        <StatCard label="Mensalidades vencidas" value={String(overdueCount)} icon={<AlertTriangle />} tone="red" onClick={() => onSelectFinance("overdue")} />
        <StatCard label="Vencem em até 3 dias" value={String(dueSoonCount)} icon={<CalendarDays />} tone="yellow" onClick={() => onSelectFinance("due_soon")} />
        <StatCard label="Recebido no mês" value={currency(received)} icon={<CircleDollarSign />} tone="blue" onClick={() => onSelectFinance("all")} />
        <StatCard label="Experimentais · retorno" value={String(experimentCount)} icon={<UserRound />} tone="purple" onClick={() => onSelectExperiments("follow_up")} />
      </>}
    </section>
    <div className="dashboard-columns">
      <section className="panel-card"><div className="panel-heading"><div><h3>Turmas de hoje</h3><p>Toque em uma turma para abrir a chamada</p></div><button className="text-button" onClick={() => onNavigate("Turmas")}>Ver turmas <ChevronRight size={16} /></button></div>
        {classes.length ? classes.map((item) => {
          const regular = activeStudents.filter((student) => student.class_id === item.id && student.status === "active").length;
          const makeups = data.makeups.filter((entry) => entry.class_id === item.id && entry.scheduled_for === today && ["scheduled", "used"].includes(entry.status)).length;
          const experiments = data.experiments.filter((entry) => entry.class_id === item.id && entry.scheduled_for?.slice(0, 10) === today && ["scheduled", "attended"].includes(entry.status)).length;
          return <button className="today-class" key={item.id} onClick={() => onSelectClass(item.id)}>
            <span className="class-time">{item.starts_at.slice(0, 5)}</span><span className="class-info"><strong>{item.name}</strong><small>{item.level} · {regular} regulares · {makeups + experiments} reservas</small></span>
            <span className="class-spots">{Math.max(0, item.capacity - regular - makeups - experiments)} vagas</span><ChevronRight size={18} />
          </button>;
        }) : <EmptyState title="Sem turmas programadas hoje" text="Confira a agenda semanal na área Turmas." />}
      </section>
      {canManage && <section className="panel-card"><div className="panel-heading"><div><h3>Contas para acompanhar</h3><p>Mensalidades em aberto e vencidas</p></div><button className="text-button" onClick={() => onSelectFinance("all")}>Financeiro <ChevronRight size={16} /></button></div>
        {balances.filter(({ balance, status }) => balance > 0 && ["overdue", "due_soon"].includes(status)).slice(0, 5).map(({ charge, student, balance, status }) =>
          <div className="attention-row" key={charge.id}><span className={`status-dot ${status}`} /><span><strong>{student?.name ?? "Aluno arquivado"}</strong><small>Venc. {charge.due_date.split("-").reverse().join("/")}</small></span><b>{currency(balance)}</b></div>)}
        {!balances.some(({ balance, status }) => balance > 0 && ["overdue", "due_soon"].includes(status)) && <EmptyState title="Tudo em dia por aqui" text="Nenhuma conta vencida ou próxima do vencimento." />}
      </section>}
    </div>
    <p className="data-note">Visão diária · Dados calculados pelo fuso de Goiânia</p>
  </div>;
}

function ClassesPage({ data, today, activeStudents, canManage, formOpen, setFormOpen, addClass, onOpenAttendance }: {
  data: DataSet; today: string; activeStudents: Student[]; canManage: boolean; formOpen: boolean; setFormOpen: (open: boolean) => void;
  addClass: (event: FormEvent<HTMLFormElement>) => void; onOpenAttendance: (id: string) => void;
}) {
  return <section className="content-section">
    <SectionHeading title="Turmas" subtitle="Níveis, horários, capacidade e ocupação">
      {canManage && <button className="primary-button" onClick={() => setFormOpen(!formOpen)}><Plus size={18} />Nova turma</button>}
    </SectionHeading>
    {formOpen && <form className="form-card form-grid" onSubmit={addClass}>
      <Input label="Nome da turma" name="name" required /><Input label="Nível" name="level" required />
      <Input label="Horário" name="starts_at" type="time" required /><Input label="Capacidade" name="capacity" type="number" min="1" required />
      <fieldset className="weekday-field"><legend>Dias da semana</legend>{dayLabels.map((day, index) => <label key={day}><input name="weekdays" value={index} type="checkbox" />{day}</label>)}</fieldset>
      <div className="form-actions"><button className="primary-button">Salvar turma</button><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancelar</button></div>
    </form>}
    <div className="class-grid">{data.classes.map((item) => {
      const regular = activeStudents.filter((student) => student.class_id === item.id && student.status === "active").length;
      const reservedMakeups = data.makeups.filter((entry) => entry.class_id === item.id && entry.scheduled_for === today && ["scheduled", "used"].includes(entry.status)).length;
      const reservedTrial = data.experiments.filter((entry) => entry.class_id === item.id && entry.scheduled_for?.slice(0, 10) === today && ["scheduled", "attended"].includes(entry.status)).length;
      const used = Math.min(item.capacity, regular + reservedMakeups + reservedTrial);
      const isToday = item.weekdays.includes(new Date(`${today}T00:00:00Z`).getUTCDay());
      return <article className="class-card" key={item.id}><div className="class-card-top"><span className="class-icon"><Dumbbell size={21} /></span><span className="status-tag neutral">{item.level}</span></div><h3>{item.name}</h3>
        <p><CalendarDays size={16} />{item.weekdays.map((day) => dayLabels[day]).join(", ") || "Sem dias"} · {item.starts_at.slice(0, 5)}</p>
        <div className="capacity-label"><span>Ocupação</span><strong>{used}/{item.capacity}</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, used / item.capacity * 100)}%` }} /></div>
        <p className="available">{Math.max(0, item.capacity - used)} vagas disponíveis</p>
        <button className="secondary-button full-width" disabled={!isToday} onClick={() => onOpenAttendance(item.id)}>{isToday ? "Abrir chamada" : "Fora da agenda de hoje"} <ChevronRight size={16} /></button>
      </article>;
    })}</div>
  </section>;
}

function AttendancePage({ data, today, classes, students, selectedClassId, setSelectedClassId, mark, markAll, canManage, absenceLimit, absenceOnly, onClearAbsenceFilter, onScheduleMakeup, onMakeupStatus, onExperimentAttendance, onRefresh }: {
  data: DataSet; today: string; classes: ClassRow[]; students: Student[]; selectedClassId: string; canManage: boolean; absenceLimit: number; absenceOnly: boolean;
  setSelectedClassId: (id: string) => void; mark: (student: string, cls: string, status: string) => void;
  onClearAbsenceFilter: () => void;
  markAll: (classId: string) => void; onScheduleMakeup: (target: { student: Student; classId: string }) => void;
  onMakeupStatus: (makeup: Makeup, status: string) => void; onExperimentAttendance: (experiment: Experiment, status: string) => void;
  onRefresh: () => void;
}) {
  const chosen = classes.find((item) => item.id === selectedClassId) ?? classes[0];
  const roster = chosen ? students.filter((student) => student.class_id === chosen.id && student.status === "active") : [];
  const displayedRoster = absenceOnly ? roster.filter((student) => consecutiveAbsences(
    data.attendance.filter((row) => row.student_id === student.id).sort((a, b) => b.class_date.localeCompare(a.class_date)).map((row) => row.status),
  ) >= absenceLimit) : roster;
  const currentAttendance = chosen ? data.attendance.filter((row) => row.class_id === chosen.id && row.class_date === today) : [];
  const exp = chosen ? data.experiments.filter((item) => item.class_id === chosen.id && item.scheduled_for?.slice(0, 10) === today && ["scheduled", "attended"].includes(item.status)) : [];
  const makeup = chosen ? data.makeups.filter((item) => item.class_id === chosen.id && item.scheduled_for === today && ["scheduled", "used"].includes(item.status)) : [];
  return <section className="content-section">
    <SectionHeading title="Chamada" subtitle={`${today.split("-").reverse().join("/")} · A chamada em branco não conta como falta`}>
      {absenceOnly && <button className="secondary-button" onClick={onClearAbsenceFilter}>Limpar filtro de faltas</button>}
      {chosen && !absenceOnly && <button className="primary-button" onClick={() => markAll(chosen.id)}><Check size={18} />Marcar sem registro como presente</button>}
    </SectionHeading>
    <div className="filter-row"><label className="field class-select"><span>Turma</span><select value={chosen?.id ?? ""} onChange={(event) => setSelectedClassId(event.target.value)}>
      {classes.length ? classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.starts_at.slice(0, 5)}</option>) : <option value="">Nenhuma turma hoje</option>}
    </select></label><button className="secondary-button" onClick={onRefresh}>Atualizar</button></div>
    {chosen && <div className="attendance-card">
      {displayedRoster.map((student) => {
        const status = currentAttendance.find((row) => row.student_id === student.id)?.status;
        const recent = data.attendance.filter((row) => row.student_id === student.id).sort((a, b) => b.class_date.localeCompare(a.class_date));
        const consecutive = consecutiveAbsences(recent.map((row) => row.status)) >= absenceLimit;
        return <article className="attendance-row" key={student.id}>
          <div className="student-avatar">{student.name.split(" ").map((word) => word[0]).slice(0, 2).join("")}</div>
          <div className="attendance-person"><strong>{student.name}</strong><small>{student.phone}</small>{consecutive && <span className="absence-warning"><AlertTriangle size={13} />{absenceLimit}+ faltas consecutivas</span>}</div>
          {status ? <StatusTag status={status} /> : <span className="not-marked">Sem marcação</span>}
          {canManage && <button className="tiny-button makeup-schedule" onClick={() => onScheduleMakeup({ student, classId: chosen.id })}>Agendar reposição</button>}
          <div className="attendance-actions">
            <button title="Presente" aria-label={`Marcar ${student.name} presente`} className={`attendance-button present ${status === "present" ? "is-selected" : ""}`} onClick={() => mark(student.id, chosen.id, "present")}><Check size={16} /></button>
            <button title="Faltou" aria-label={`Marcar ${student.name} faltou`} className={`attendance-button absent ${status === "absent" ? "is-selected" : ""}`} onClick={() => mark(student.id, chosen.id, "absent")}><X size={16} /></button>
            <button title="Reposição" aria-label={`Marcar ${student.name} reposição`} className={`attendance-button makeup ${status === "makeup" ? "is-selected" : ""}`} onClick={() => mark(student.id, chosen.id, "makeup")}><CalendarDays size={16} /></button>
            <button title="Falta justificada" aria-label={`Marcar ${student.name} falta justificada`} className={`attendance-button excused ${status === "excused" ? "is-selected" : ""}`} onClick={() => mark(student.id, chosen.id, "excused")}>J</button>
          </div>
        </article>;
      })}
      {exp.map((item) => <div className="attendance-row guest-row" key={item.id}><div className="student-avatar guest-avatar">EX</div><div className="attendance-person"><strong>{item.name}</strong><small>Aula experimental · {item.phone}</small></div><StatusTag status={item.status} />{item.status === "scheduled" && <button className="tiny-button" onClick={() => onExperimentAttendance(item, "attended")}>Registrar presença</button>}</div>)}
      {makeup.map((item) => <div className="attendance-row guest-row" key={item.id}><div className="student-avatar guest-avatar">RP</div><div className="attendance-person"><strong>{students.find((student) => student.id === item.student_id)?.name ?? "Aluno"}</strong><small>Reposição · {item.scheduled_for.split("-").reverse().join("/")}</small></div><StatusTag status={item.status === "used" ? "present" : "makeup"} />{item.status === "scheduled" && <button className="tiny-button" onClick={() => mark(item.student_id, item.class_id, "makeup")}>Registrar presença</button>}</div>)}
      {!displayedRoster.length && !exp.length && !makeup.length && <EmptyState title={absenceOnly ? "Nenhum aluno com faltas consecutivas" : "Turma sem alunos"} text={absenceOnly ? `Nenhum aluno atingiu ${absenceLimit} faltas consecutivas nas chamadas registradas.` : "Alunos ativos e experimentais agendados aparecem aqui."} />}
    </div>}
    {canManage && data.makeups.some((item) => item.status === "scheduled") && <section className="panel-card"><div className="panel-heading"><div><h3>Reposições reservadas</h3><p>Confirme o comparecimento ou libere a vaga</p></div></div>
      {data.makeups.filter((item) => item.status === "scheduled").map((item) => <div className="portal-history" key={item.id}>
        <span>{students.find((student) => student.id === item.student_id)?.name ?? "Aluno"} · {data.classes.find((cls) => cls.id === item.class_id)?.name ?? "Turma"} · {item.scheduled_for.split("-").reverse().join("/")}</span>
        {item.scheduled_for === today && <button className="tiny-button" onClick={() => mark(item.student_id, item.class_id, "makeup")}>Registrar presença</button>}
        <button className="tiny-button danger-text" onClick={() => onMakeupStatus(item, "cancelled")}>Cancelar</button>
      </div>)}
    </section>}
  </section>;
}

function FinancePage({ balances, payments, adjustments, students, initialFilter, onGenerate, onPayment, onAdjust, onReversePayment }: {
  balances: { charge: Charge; student?: Student; balance: number; status: string }[]; payments: Payment[]; adjustments: Adjustment[];
  students: Student[]; initialFilter: string; onGenerate: () => void; onPayment: (charge: Charge) => void; onAdjust: (charge: Charge) => void;
  onReversePayment: (payment: Payment) => void;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [expandedCharge, setExpandedCharge] = useState<string | null>(null);
  const filtered = balances.filter(({ status }) => filter === "all" || status === filter);
  return <section className="content-section">
    <SectionHeading title="Financeiro" subtitle={`${balances.length} mensalidades registradas`}>
      <button className="primary-button" onClick={onGenerate}><Plus size={18} />Gerar cobranças do mês</button>
    </SectionHeading>
    <div className="finance-summary">
      <div><span>Total em aberto</span><strong>{currency(balances.reduce((sum, entry) => sum + entry.balance, 0))}</strong></div>
      <div><span>Pagamentos registrados</span><strong>{payments.filter((item) => !item.reversed_at).length}</strong></div>
      <div><span>Alunos ativos</span><strong>{students.filter((item) => item.status === "active").length}</strong></div>
    </div>
    <div className="filter-row"><label className="field class-select"><span>Filtrar situação</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="all">Todas</option><option value="overdue">Vencida</option><option value="due_soon">Vence em até 3 dias</option><option value="open">Em aberto</option><option value="paid">Quitada</option><option value="waived">Isenta</option><option value="cancelled">Cancelada</option>
    </select></label><div className="legend"><span className="green-dot" />Quitada <span className="blue-dot" />Em aberto <span className="yellow-dot" />Próxima <span className="red-dot" />Vencida</div></div>
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Saldo</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>{filtered.map(({ charge, student, balance, status }) => {
        const competence = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
          .format(new Date(`${charge.competence}T12:00:00Z`));
        const message = monthlyChargeMessage(student?.name ?? "Aluno", charge.competence.slice(0, 7), currency(balance), charge.due_date);
        const rawPhone = student?.phone.replace(/\D/g, "") ?? "";
        const phone = rawPhone ? (rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`) : "";
        const history = payments.filter((item) => item.charge_id === charge.id);
        const adjustmentsForCharge = adjustments.filter((item) => item.charge_id === charge.id);
        return <Fragment key={charge.id}>
          <tr><td><strong>{student?.name ?? "Aluno arquivado"}</strong><small>{student?.phone}</small></td>
            <td className="capitalize">{competence}</td><td>{charge.due_date.split("-").reverse().join("/")}</td>
            <td>{currency(charge.amount_cents)}</td><td><strong>{currency(balance)}</strong></td><td><StatusTag status={status} /></td>
            <td><div className="row-actions">{balance > 0 && <><button className="tiny-button" onClick={() => onPayment(charge)}>Baixar</button><button className="tiny-button" onClick={() => onAdjust(charge)}>Ajustar</button></>}
              {history.length + adjustmentsForCharge.length > 0 && <button className="tiny-button" onClick={() => setExpandedCharge(expandedCharge === charge.id ? null : charge.id)}>Histórico</button>}
              {phone && balance > 0 && <a className="whatsapp-link" href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" aria-label={`Preparar WhatsApp para ${student?.name}`}><MessageCircle size={17} /></a>}</div></td>
          </tr>
          {expandedCharge === charge.id && <tr><td className="charge-history" colSpan={7}>
            {history.map((item) => <div className="history-entry" key={item.id}><span>Pagamento · {item.paid_at} · {currency(item.amount_cents)} · {item.method === "manual" ? "Manual" : item.method}</span>{item.reversed_at ? <StatusTag status="Estornado" /> : <><StatusTag status="Recebido" /><button className="tiny-button danger-text" onClick={() => onReversePayment(item)}>Estornar</button></>}</div>)}
            {adjustmentsForCharge.map((item) => <div className="history-entry" key={item.id}><span>{labels[item.kind] ?? item.kind} · {currency(item.amount_cents)}{item.note ? ` · ${item.note}` : ""}</span><StatusTag status="Registrado" /></div>)}
          </td></tr>}
        </Fragment>;
      })}</tbody></table>
      {!filtered.length && <EmptyState title="Nenhuma cobrança neste filtro" text="Gere as cobranças do mês ou altere o filtro." />}
    </div>
    <p className="data-note">Competência mensal e data de recebimento são registradas separadamente. Pix e lembretes automáticos estão desativados.</p>
  </section>;
}

function ExperimentsPage({ data, formOpen, setFormOpen, addExperiment, initialFilter, onConvert, onStatus }: {
  data: DataSet; formOpen: boolean; setFormOpen: (open: boolean) => void; addExperiment: (event: FormEvent<HTMLFormElement>) => void;
  initialFilter: string;
  onConvert: (experiment: Experiment) => void; onStatus: (experiment: Experiment, status: string) => void;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const filteredExperiments = data.experiments.filter((item) => filter === "all" || item.status === filter);
  return <section className="content-section">
    <SectionHeading title="Aulas experimentais" subtitle={`${data.experiments.filter((item) => item.status === "follow_up").length} aguardando retorno`}>
      <button className="primary-button" onClick={() => setFormOpen(!formOpen)}><Plus size={18} />Agendar experimental</button>
    </SectionHeading>
    {formOpen && <form className="form-card form-grid" onSubmit={addExperiment}>
      <Input label="Nome" name="name" required /><Input label="WhatsApp" name="phone" type="tel" required />
      <label className="field"><span>Turma</span><select name="class_id" defaultValue=""><option value="">A definir</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Input label="Data" name="date" type="date" defaultValue={inputDate()} required /><Input label="Horário" name="time" type="time" defaultValue="18:00" />
      <Input label="Observação" name="notes" /><div className="form-actions"><button className="primary-button">Agendar</button><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancelar</button></div>
    </form>}
    <div className="filter-row"><label className="field class-select"><span>Filtrar situação</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="all">Todas</option><option value="scheduled">Agendada</option><option value="attended">Compareceu</option><option value="follow_up">Aguardando retorno</option><option value="converted">Convertida</option><option value="closed">Encerrada</option>
    </select></label></div>
    <div className="experiment-list">{filteredExperiments.map((item) => <article className="experiment-card" key={item.id}>
      <div className="student-avatar guest-avatar">{item.name.split(" ").map((word) => word[0]).slice(0, 2).join("")}</div>
      <div className="experiment-info"><strong>{item.name}</strong><small>{item.phone} · {data.classes.find((cls) => cls.id === item.class_id)?.name ?? "Turma a definir"}</small>
        <small>{item.scheduled_for ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(item.scheduled_for)) : "Sem data"}{item.notes ? ` · ${item.notes}` : ""}</small>
      </div>
      <StatusTag status={item.status} />
      <div className="row-actions">
        {item.status === "scheduled" && <button className="tiny-button" onClick={() => onStatus(item, "attended")}>Marcar comparecimento</button>}
        {["scheduled", "attended"].includes(item.status) && <button className="tiny-button" onClick={() => onStatus(item, "follow_up")}>Aguardar retorno</button>}
        {item.status !== "converted" && item.status !== "closed" && <button className="tiny-button convert-button" onClick={() => onConvert(item)}>Converter em aluno</button>}
      </div>
    </article>)}
      {!filteredExperiments.length && <EmptyState title="Nenhuma experimental neste filtro" text="Altere o filtro ou agende uma nova aula." />}
    </div>
  </section>;
}

function ReportsPage({ data, balances, exportCsv }: {
  data: DataSet; balances: { charge: Charge; student?: Student; balance: number; status: string }[];
  exportCsv: (startDate?: string, endDate?: string, classId?: string) => void;
}) {
  const [startDate, setStartDate] = useState(`${inputDate().slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(inputDate());
  const [classId, setClassId] = useState("all");
  const matchesClass = (studentId: string) => classId === "all" || data.students.find((student) => student.id === studentId)?.class_id === classId;
  const attendanceRows = data.attendance.filter((item) => item.class_date >= startDate && item.class_date <= endDate
    && (classId === "all" || item.class_id === classId));
  const periodPayments = data.payments.filter((payment) => !payment.reversed_at && payment.paid_at >= startDate && payment.paid_at <= endDate
    && matchesClass(data.charges.find((charge) => charge.id === payment.charge_id)?.student_id ?? ""));
  const received = periodPayments.reduce((sum, item) => sum + item.amount_cents, 0);
  const periodBalances = balances.filter(({ charge, student }) => charge.due_date >= startDate && charge.due_date <= endDate
    && (classId === "all" || student?.class_id === classId));
  const periodExperiments = data.experiments.filter((item) => {
    const scheduledDate = item.scheduled_for?.slice(0, 10) ?? "";
    return scheduledDate >= startDate && scheduledDate <= endDate && (classId === "all" || item.class_id === classId);
  });
  const attended = attendanceRows.filter((item) => ["present", "makeup"].includes(item.status)).length;
  const conversionRate = periodExperiments.length ? Math.round(periodExperiments.filter((item) => item.status === "converted").length / periodExperiments.length * 100) : 0;
  return <section className="content-section">
    <SectionHeading title="Relatórios" subtitle="Resumo de recebimentos, frequência e ocupação">
      <button className="secondary-button" onClick={() => exportCsv(startDate, endDate, classId)}><ArrowDownToLine size={17} />Exportar CSV</button>
    </SectionHeading>
    <div className="filter-row report-filters">
      <label className="field"><span>De</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="field"><span>Até</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label className="field"><span>Turma</span><select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="all">Todas as turmas</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="report-grid">
      <div className="report-card"><span>Recebido no período</span><strong>{currency(received)}</strong><small>Pagamentos não estornados</small></div>
      <div className="report-card"><span>Saldo em atraso</span><strong>{currency(periodBalances.filter(({ status }) => status === "overdue").reduce((sum, entry) => sum + entry.balance, 0))}</strong><small>{periodBalances.filter(({ status }) => status === "overdue").length} cobranças</small></div>
      <div className="report-card"><span>Frequência registrada</span><strong>{attendanceRows.length ? `${Math.round(attended / attendanceRows.length * 100)}%` : "—"}</strong><small>{attended} presenças em {attendanceRows.length} chamadas</small></div>
      <div className="report-card"><span>Conversão de experimentais</span><strong>{conversionRate}%</strong><small>{periodExperiments.filter((item) => item.status === "converted").length} de {periodExperiments.length} pessoas</small></div>
    </div>
    <div className="panel-card report-occupancy"><div className="panel-heading"><div><h3>Ocupação das turmas</h3><p>Alunos ativos ÷ capacidade cadastrada</p></div></div>
      {data.classes.filter((item) => classId === "all" || item.id === classId).map((item) => {
        const count = data.students.filter((student) => student.class_id === item.id && student.status === "active" && !student.archived_at).length;
        return <div className="occupancy-row" key={item.id}><span>{item.name}<small>{item.level}</small></span><div className="capacity-track"><span style={{ width: `${Math.min(100, count / item.capacity * 100)}%` }} /></div><strong>{count}/{item.capacity}</strong></div>;
      })}
    </div>
  </section>;
}

function SettingsPage({ profiles, inspectBackup, absenceLimit, onSaveAbsenceLimit }: {
  profiles: Profile[]; inspectBackup: (file?: File) => void; absenceLimit: number; onSaveAbsenceLimit: (value: number) => void;
}) {
  const [threshold, setThreshold] = useState(absenceLimit);
  return <section className="content-section">
    <SectionHeading title="Configurações" subtitle="Acessos, dados e preferências" />
    <div className="settings-grid">
      <article className="panel-card"><div className="panel-heading"><div><h3><ShieldCheck size={19} />Acessos da equipe</h3><p>As permissões de dados são protegidas também no banco.</p></div></div>
        {profiles.map((profile) => <div className="profile-row" key={profile.id}><span className="student-avatar">{profile.display_name.slice(0, 2).toUpperCase() || "RL"}</span><span><strong>{profile.display_name || "Conta sem nome"}</strong><small>{profile.id}</small></span><StatusTag status={profile.role === "teacher" ? "Professor" : profile.role === "admin" ? "Administrador" : "Aluno"} /></div>)}
        <p className="data-note">Crie contas individuais no Supabase Authentication. Admin atribui papel e associações; nunca compartilhe senha ou chave service_role.</p>
      </article>
      <article className="panel-card"><div className="panel-heading"><div><h3><FileUp size={19} />Importar backup JSON</h3><p>Prévia e detecção de duplicados antes de importar.</p></div></div>
        <label className="upload-box"><FileUp size={25} /><strong>Selecionar arquivo JSON</strong><span>O arquivo é lido apenas nesta tela até confirmar a importação.</span><input type="file" accept=".json,application/json" onChange={(event) => void inspectBackup(event.target.files?.[0])} /></label>
      </article>
      <article className="panel-card"><div className="panel-heading"><div><h3><Settings size={19} />Preferências</h3><p>Fuso horário e serviços conectados</p></div></div>
        <div className="preference-row"><span>Fuso horário</span><strong>America/Sao_Paulo · Goiânia</strong></div>
        <div className="preference-row"><span>Alertar após faltas consecutivas</span><div className="inline-setting"><input aria-label="Limite de faltas consecutivas" type="number" min="1" max="10" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /><button className="tiny-button" onClick={() => onSaveAbsenceLimit(threshold)}>Salvar</button></div></div>
        <div className="preference-row"><span>WhatsApp automático</span><StatusTag status="Desativado" /></div>
        <div className="preference-row"><span>Pix integrado</span><StatusTag status="Desativado" /></div>
        <div className="preference-row"><span>Banco sincronizado</span><StatusTag status="Supabase" /></div>
      </article>
    </div>
  </section>;
}

function SectionHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="heading-actions">{children}</div></div>;
}

function StatCard({ label, value, icon, tone, onClick }: { label: string; value: string; icon: ReactNode; tone: string; onClick: () => void }) {
  return <button className={`stat-card ${tone}`} onClick={onClick}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-more">Ver lista <ChevronRight size={14} /></span></button>;
}

function StatusTag({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/ /g, "_");
  return <span className={`status-tag ${normalized}`}>{labels[normalized] ?? status}</span>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span className="empty-icon"><CalendarDays size={20} /></span><strong>{title}</strong><p>{text}</p></div>;
}

function Input({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return <label className="field"><span>{label}</span><input name={name} {...props} /></label>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></div>{children}
    </section>
  </div>;
}
