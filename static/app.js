
const $ = (id) => document.getElementById(id);

const state = {
    tasks: [],
    notes: [],
    timetable: [],
    sessions: [],
    profile: {},
    settings: {},
    goals: [],
    calendarDate: new Date(),
    selectedDate: new Date().toISOString().slice(0, 10),
    timerSeconds: 25 * 60,
    timerInitial: 25 * 60,
    timerRunning: false,
    timerInterval: null,
    toastTimeout: null
};

const escapeHTML = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]
);

function todayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function formatDate(value) {
    if (!value) return "No deadline";
    const date = new Date(value + "T00:00:00");
    return Number.isNaN(date.getTime())
        ? escapeHTML(value)
        : date.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        });
}

function showToast(message) {
    $("toast").textContent = message;
    $("toast").classList.remove("hidden");
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        $("toast").classList.add("hidden");
    }, 2800);
}

async function api(path, method = "GET", data = null) {
    const options = { method, headers: {} };

    if (data !== null) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(data);
    }

    const response = await fetch("/api/" + path, options);
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(result.error || "Something went wrong.");
    }

    return result;
}

async function runAction(action, successMessage) {
    try {
        await action();
        await refreshData();
        if (successMessage) showToast(successMessage);
    } catch (error) {
        showToast(error.message);
    }
}

function emptyMessage(message) {
    return `<div class="empty-state">${escapeHTML(message)}</div>`;
}

function priorityClass(priority) {
    return "priority-" + String(priority || "Medium").toLowerCase();
}

function isOverdue(task) {
    return task.status !== "Completed" &&
        task.due_date &&
        task.due_date < todayString();
}

function taskDetails(task) {
    const deadline = task.due_date
        ? formatDate(task.due_date)
        : "No deadline";

    let deadlineClass = "";
    let deadlineText = deadline;

    if (isOverdue(task)) {
        deadlineClass = "status-overdue";
        deadlineText = "Overdue · " + deadline;
    } else if (task.status === "Completed") {
        deadlineClass = "status-completed";
    }

    return `
        <p>
            ${escapeHTML(task.subject || "No subject")}
            · ${escapeHTML(task.task_type || "Study")}
            · <span class="${priorityClass(task.priority)}">
                ${escapeHTML(task.priority || "Medium")} priority
              </span>
        </p>
        <p class="${deadlineClass}">
            Deadline: ${deadlineText}
            · ${escapeHTML(task.status)}
        </p>
        ${task.description
            ? `<p>${escapeHTML(task.description)}</p>`
            : ""}
    `;
}

function taskCard(task, compact = false) {
    return `
        <article class="item-card">
            <div>
                <h4>${escapeHTML(task.title)}</h4>
                ${taskDetails(task)}
            </div>
            ${compact ? "" : `
                <div class="item-actions">
                    <button class="small-button"
                        data-task-action="toggle"
                        data-id="${task.id}">
                        ${task.status === "Completed"
                            ? "Reopen" : "Complete"}
                    </button>
                    <button class="small-button"
                        data-task-action="edit"
                        data-id="${task.id}">Edit</button>
                    <button class="small-button delete"
                        data-task-action="delete"
                        data-id="${task.id}">Delete</button>
                </div>
            `}
        </article>
    `;
}

function renderDashboard() {
    const tasks = state.tasks;
    const completed = tasks.filter(t => t.status === "Completed").length;
    const pending = tasks.length - completed;
    const overdue = tasks.filter(isOverdue).length;
    const percent = tasks.length
        ? Math.round(completed / tasks.length * 100)
        : 0;

    $("total-tasks").textContent = tasks.length;
    $("completed-tasks").textContent = completed;
    $("pending-tasks").textContent = pending;
    $("overdue-tasks").textContent = overdue;
    $("progress-label").textContent = percent + "%";
    $("progress-fill").style.width = percent + "%";

    const name = state.profile.name || "Student";
    $("welcome-name").textContent = `Hello, ${name}! 👋`;

    $("today-date").textContent = new Date().toLocaleDateString(
        "en-IN", { day: "numeric", month: "short" }
    );

    const todayTasks = tasks.filter(t =>
        t.due_date === todayString() && t.status !== "Completed"
    );

    $("today-list").innerHTML = todayTasks.length
        ? todayTasks.map(t => taskCard(t, true)).join("")
        : emptyMessage("No pending tasks due today. Enjoy your progress!");

    const upcoming = tasks
        .filter(t => t.status !== "Completed" &&
            t.due_date >= todayString())
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5);

    $("upcoming-list").innerHTML = upcoming.length
        ? upcoming.map(t => taskCard(t, true)).join("")
        : emptyMessage("No upcoming deadlines. Add a task when you're ready.");

    const todayGoal = state.goals.find(g => g.goal_date === todayString());
    const target = Number(todayGoal?.target_minutes ??
        state.profile.daily_goal ?? 120);
    const studied = Number(todayGoal?.studied_minutes || 0);
    const goalPercent = target > 0
        ? Math.min(100, Math.round(studied / target * 100))
        : 0;

    $("goal-hours").textContent = target >= 60
        ? `${Math.floor(target / 60)}h ${target % 60 ? target % 60 + "m" : ""}`
        : `${target} minutes`;

    $("goal-fill").style.width = goalPercent + "%";
    $("goal-message").textContent = goalPercent >= 100
        ? "Daily goal reached. Great work!"
        : `${goalPercent}% of your daily study goal completed.`;
    $("study-minutes").textContent = `${studied} minutes studied today`;
}

function renderTasks() {
    const search = $("task-search").value.trim().toLowerCase();
    const status = $("filter-status").value;
    const priority = $("filter-priority").value;
    const type = $("filter-type").value;
    const sort = $("sort-tasks").value;

    let tasks = state.tasks.filter(t => {
        const text = [
            t.title, t.subject, t.description, t.task_type
        ].join(" ").toLowerCase();

        return text.includes(search) &&
            (status === "All" || t.status === status) &&
            (priority === "All" || t.priority === priority) &&
            (type === "All" || t.task_type === type);
    });

    tasks.sort((a, b) => {
        if (sort === "priority") {
            const rank = { High: 1, Medium: 2, Low: 3 };
            return (rank[a.priority] || 2) - (rank[b.priority] || 2);
        }

        if (sort === "title") {
            return a.title.localeCompare(b.title);
        }

        return (a.due_date || "9999-12-31")
            .localeCompare(b.due_date || "9999-12-31");
    });

    $("task-list").innerHTML = tasks.length
        ? tasks.map(t => taskCard(t)).join("")
        : emptyMessage("No matching tasks. Try another filter or add a task.");
}

function renderTimetable() {
    const days = [
        "Monday", "Tuesday", "Wednesday", "Thursday",
        "Friday", "Saturday", "Sunday"
    ];

    const slots = [...state.timetable].sort((a, b) =>
        days.indexOf(a.day) - days.indexOf(b.day) ||
        a.start_time.localeCompare(b.start_time)
    );

    $("timetable-list").innerHTML = slots.length
        ? slots.map(slot => `
            <article class="item-card">
                <div>
                    <h4>${escapeHTML(slot.day)} · ${escapeHTML(slot.subject)}</h4>
                    <p>${escapeHTML(slot.start_time)} – ${escapeHTML(slot.end_time)}</p>
                    <p>${escapeHTML(slot.topic || "Study session")}</p>
                </div>
                <div class="item-actions">
                    <button class="small-button delete"
                        data-delete-table="timetable"
                        data-id="${slot.id}">Delete</button>
                </div>
            </article>
        `).join("")
        : emptyMessage("Your weekly timetable is empty. Add your first slot.");
}

function renderSessions() {
    const sessions = [...state.sessions].sort((a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.start_time.localeCompare(b.start_time)
    );

    $("session-list").innerHTML = sessions.length
        ? sessions.map(session => `
            <article class="item-card">
                <div>
                    <h4>${escapeHTML(session.title)}</h4>
                    <p>${escapeHTML(session.subject || "General study")}</p>
                    <p>${formatDate(session.session_date)} ·
                        ${escapeHTML(session.start_time || "Time not set")} ·
                        ${escapeHTML(session.duration_minutes)} minutes</p>
                    <p>Status: ${escapeHTML(session.status || "Planned")}</p>
                </div>
                <div class="item-actions">
                    <button class="small-button"
                        data-session-action="toggle"
                        data-id="${session.id}">
                        ${session.status === "Completed"
                            ? "Reopen" : "Complete"}
                    </button>
                    <button class="small-button delete"
                        data-delete-table="sessions"
                        data-id="${session.id}">Delete</button>
                </div>
            </article>
        `).join("")
        : emptyMessage("No study sessions planned yet.");
}

function renderNotes() {
    $("note-list").innerHTML = state.notes.length
        ? state.notes.map(note => `
            <article class="note-card">
                <h3>${escapeHTML(note.title)}</h3>
                <p class="muted">${escapeHTML(note.subject)}</p>
                <div class="note-content">${escapeHTML(note.content)}</div>
                <div class="form-actions">
                    <button class="small-button"
                        data-note-action="edit"
                        data-id="${note.id}">Edit</button>
                    <button class="small-button delete"
                        data-note-action="delete"
                        data-id="${note.id}">Delete</button>
                </div>
            </article>
        `).join("")
        : emptyMessage("No notes yet. Create notes for your subjects.");
}

function renderProfile() {
    $("profile-name").value = state.profile.name || "Student";
    $("profile-course").value = state.profile.course || "";
    $("profile-semester").value = state.profile.semester || "";
    $("profile-goal").value = state.profile.daily_goal || 120;
}

function renderCalendar() {
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();

    $("calendar-month").textContent =
        state.calendarDate.toLocaleDateString("en-IN", {
            month: "long", year: "numeric"
        });

    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const cells = [];

    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(day => {
        cells.push(`<div class="weekday">${day}</div>`);
    });

    for (let cell = 0; cell < totalCells; cell++) {
        const dayNumber = cell - offset + 1;
        const date = new Date(year, month, dayNumber);
        const dateString = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");

        const inMonth = date.getMonth() === month;
        const hasItems = state.tasks.some(t => t.due_date === dateString) ||
            state.sessions.some(s => s.session_date === dateString);

        cells.push(`
            <button class="calendar-day
                ${inMonth ? "" : "muted-day"}
                ${hasItems ? "has-items" : ""}
                ${state.selectedDate === dateString ? "selected" : ""}"
                data-calendar-date="${dateString}">
                ${date.getDate()}
            </button>
        `);
    }

    $("calendar-grid").innerHTML = cells.join("");
    renderCalendarDetails();
}

function renderCalendarDetails() {
    const date = state.selectedDate;

    const tasks = state.tasks.filter(t => t.due_date === date);
    const sessions = state.sessions.filter(s => s.session_date === date);

    const content = [
        ...tasks.map(t => `
            <article class="item-card">
                <div>
                    <h4>Task: ${escapeHTML(t.title)}</h4>
                    <p>${escapeHTML(t.subject)} · ${escapeHTML(t.status)}</p>
                </div>
            </article>
        `),
        ...sessions.map(s => `
            <article class="item-card">
                <div>
                    <h4>Study: ${escapeHTML(s.title)}</h4>
                    <p>${escapeHTML(s.subject)} ·
                        ${escapeHTML(s.start_time || "Time not set")}</p>
                </div>
            </article>
        `)
    ];

    $("calendar-details").innerHTML = `
        <h3>${formatDate(date)}</h3>
        ${content.length ? content.join("") : emptyMessage("Nothing scheduled for this date.")}
    `;
}

async function refreshData() {
    const [tasks, notes, timetable, sessions, profile, settings, goals] =
        await Promise.all([
            api("tasks"), api("notes"), api("timetable"),
            api("sessions"), api("profile"), api("settings"),
            api("goals")
        ]);

    state.tasks = tasks;
    state.notes = notes;
    state.timetable = timetable;
    state.sessions = sessions;
    state.profile = profile[0] || {};
    state.settings = settings[0] || { theme: "light" };
    state.goals = goals;

    document.body.classList.toggle(
        "dark", state.settings.theme === "dark"
    );

    renderDashboard();
    renderTasks();
    renderTimetable();
    renderSessions();
    renderNotes();
    renderProfile();
    renderCalendar();
}

function showView(view) {
    document.querySelectorAll(".view").forEach(section => {
        section.classList.toggle("active", section.id === view);
    });

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
    });

    const activeButton = document.querySelector(
        `.nav-link[data-view="${view}"]`
    );

    $("page-title").textContent = activeButton
        ? activeButton.textContent.trim().replace(/^[⌂☷▦◷◎▤◴♙⚙]\s*/, "")
        : view;

    if (view === "calendar") renderCalendar();
    if (view === "tasks") renderTasks();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.go));
});

// Task creation and editing
function resetTaskForm() {
    $("task-form").reset();
    $("task-id").value = "";
    $("task-form").classList.add("hidden");
}

$("show-task-form").addEventListener("click", () => {
    resetTaskForm();
    $("task-form").classList.remove("hidden");
    $("task-title").focus();
});

$("cancel-task").addEventListener("click", resetTaskForm);

$("task-form").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("task-id").value;
    const data = {
        title: $("task-title").value.trim(),
        subject: $("task-subject").value.trim(),
        task_type: $("task-type").value,
        due_date: $("task-date").value,
        priority: $("task-priority").value,
        status: $("task-status").value,
        description: $("task-description").value.trim()
    };

    if (!data.title) return showToast("Please enter a task title.");

    await runAction(async () => {
        await api(id ? `tasks/${id}` : "tasks", id ? "PUT" : "POST", data);
        resetTaskForm();
    }, id ? "Task updated." : "Task added.");
});

$("task-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-task-action]");
    if (!button) return;

    const task = state.tasks.find(t => t.id === Number(button.dataset.id));
    if (!task) return;

    const action = button.dataset.taskAction;

    if (action === "edit") {
        $("task-id").value = task.id;
        $("task-title").value = task.title;
        $("task-subject").value = task.subject || "";
        $("task-type").value = task.task_type || "Study";
        $("task-date").value = task.due_date || "";
        $("task-priority").value = task.priority || "Medium";
        $("task-status").value = task.status || "Pending";
        $("task-description").value = task.description || "";
        $("task-form").classList.remove("hidden");
        $("task-title").focus();
        return;
    }

    if (action === "delete") {
        if (!confirm(`Delete "${task.title}"?`)) return;

        await runAction(
            () => api(`tasks/${task.id}`, "DELETE"),
            "Task deleted."
        );
    }

    if (action === "toggle") {
        await runAction(
            () => api(`tasks/${task.id}`, "PUT", {
                status: task.status === "Completed" ? "Pending" : "Completed"
            }),
            "Task status updated."
        );
    }
});

["task-search", "filter-status", "filter-priority",
 "filter-type", "sort-tasks"].forEach(id => {
    $(id).addEventListener("input", renderTasks);
    $(id).addEventListener("change", renderTasks);
});

// Timetable
$("show-timetable-form").addEventListener("click", () => {
    $("timetable-form").classList.remove("hidden");
});

$("cancel-slot").addEventListener("click", () => {
    $("timetable-form").reset();
    $("timetable-form").classList.add("hidden");
});

$("timetable-form").addEventListener("submit", async event => {
    event.preventDefault();

    const start = $("slot-start").value;
    const end = $("slot-end").value;

    if (end <= start) return showToast("End time must be after start time.");

    await runAction(async () => {
        await api("timetable", "POST", {
            day: $("slot-day").value,
            subject: $("slot-subject").value.trim(),
            start_time: start,
            end_time: end,
            topic: $("slot-topic").value.trim()
        });
        $("timetable-form").reset();
        $("timetable-form").classList.add("hidden");
    }, "Timetable slot saved.");
});

// Study sessions
$("show-session-form").addEventListener("click", () => {
    $("session-date").value = todayString();
    $("session-form").classList.remove("hidden");
});

$("cancel-session").addEventListener("click", () => {
    $("session-form").reset();
    $("session-form").classList.add("hidden");
});

$("session-form").addEventListener("submit", async event => {
    event.preventDefault();

    const duration = Number($("session-duration").value);
    if (!Number.isFinite(duration) || duration < 1) {
        return showToast("Enter a valid session duration.");
    }

    await runAction(async () => {
        await api("sessions", "POST", {
            title: $("session-title").value.trim(),
            subject: $("session-subject").value.trim(),
            session_date: $("session-date").value,
            start_time: $("session-start").value,
            duration_minutes: duration,
            status: "Planned"
        });
        $("session-form").reset();
        $("session-form").classList.add("hidden");
    }, "Study session planned.");
});

$("session-list").addEventListener("click", async event => {
    const toggle = event.target.closest("[data-session-action]");
    const del = event.target.closest("[data-delete-table]");

    if (toggle) {
        const session = state.sessions.find(
            s => s.id === Number(toggle.dataset.id)
        );
        if (!session) return;

        await runAction(
            () => api(`sessions/${session.id}`, "PUT", {
                status: session.status === "Completed" ? "Planned" : "Completed"
            }),
            "Session status updated."
        );
    }

    if (del) {
        if (!confirm("Delete this study session?")) return;
        await runAction(
            () => api(`sessions/${del.dataset.id}`, "DELETE"),
            "Study session deleted."
        );
    }
});

$("timetable-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-table]");
    if (!button) return;
    if (!confirm("Delete this timetable slot?")) return;

    await runAction(
        () => api(`timetable/${button.dataset.id}`, "DELETE"),
        "Timetable slot deleted."
    );
});

// Subject notes
function resetNoteForm() {
    $("note-form").reset();
    $("note-id").value = "";
    $("note-form").classList.add("hidden");
}

$("show-note-form").addEventListener("click", () => {
    resetNoteForm();
    $("note-form").classList.remove("hidden");
});

$("cancel-note").addEventListener("click", resetNoteForm);

$("note-form").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("note-id").value;
    const data = {
        title: $("note-title").value.trim(),
        subject: $("note-subject").value.trim(),
        content: $("note-content").value.trim()
    };

    await runAction(async () => {
        await api(id ? `notes/${id}` : "notes", id ? "PUT" : "POST", data);
        resetNoteForm();
    }, id ? "Note updated." : "Note saved.");
});

$("note-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-note-action]");
    if (!button) return;

    const note = state.notes.find(n => n.id === Number(button.dataset.id));
    if (!note) return;

    if (button.dataset.noteAction === "edit") {
        $("note-id").value = note.id;
        $("note-title").value = note.title;
        $("note-subject").value = note.subject || "";
        $("note-content").value = note.content || "";
        $("note-form").classList.remove("hidden");
        $("note-title").focus();
    } else if (confirm(`Delete note "${note.title}"?`)) {
        await runAction(
            () => api(`notes/${note.id}`, "DELETE"),
            "Note deleted."
        );
    }
});

// Calendar
$("prev-month").addEventListener("click", () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    renderCalendar();
});

$("next-month").addEventListener("click", () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    renderCalendar();
});

$("calendar-grid").addEventListener("click", event => {
    const button = event.target.closest("[data-calendar-date]");
    if (!button) return;
    state.selectedDate = button.dataset.calendarDate;
    renderCalendar();
});

// Profile
$("profile-form").addEventListener("submit", async event => {
    event.preventDefault();

    const goal = Number($("profile-goal").value);
    if (!Number.isFinite(goal) || goal < 1) {
        return showToast("Daily study goal must be at least one minute.");
    }

    await runAction(() => api("profile", "POST", {
        name: $("profile-name").value.trim() || "Student",
        course: $("profile-course").value.trim(),
        semester: $("profile-semester").value.trim(),
        daily_goal: goal
    }), "Profile saved.");
});

// Theme settings
async function setTheme(theme) {
    await runAction(
        () => api("settings", "POST", { theme }),
        "Theme updated."
    );
}

$("theme-toggle").addEventListener("click", () => {
    setTheme(document.body.classList.contains("dark") ? "light" : "dark");
});

document.querySelectorAll("[data-theme]").forEach(button => {
    button.addEventListener("click", () => setTheme(button.dataset.theme));
});

// Study timer
function updateTimerDisplay() {
    const minutes = Math.floor(state.timerSeconds / 60);
    const seconds = state.timerSeconds % 60;

    $("timer-display").textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resetTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.timerRunning = false;
    state.timerSeconds = state.timerInitial;
    $("timer-start").textContent = "Start";
    $("timer-status").textContent = "Ready when you are.";
    updateTimerDisplay();
}

async function recordStudyMinutes(minutes) {
    if (minutes <= 0) return;

    const today = todayString();
    const existing = state.goals.find(g => g.goal_date === today);

    if (existing) {
        await api(`goals/${existing.id}`, "PUT", {
            studied_minutes: Number(existing.studied_minutes || 0) + minutes
        });
    } else {
        await api("goals", "POST", {
            goal_date: today,
            target_minutes: Number(state.profile.daily_goal || 120),
            studied_minutes: minutes
        });
    }

    await refreshData();
}

document.querySelectorAll(".timer-mode").forEach(button => {
    button.addEventListener("click", () => {
        resetTimer();
        state.timerInitial = Number(button.dataset.minutes) * 60;
        state.timerSeconds = state.timerInitial;

        document.querySelectorAll(".timer-mode").forEach(mode => {
            mode.classList.toggle("active", mode === button);
        });

        updateTimerDisplay();
    });
});

$("timer-start").addEventListener("click", () => {
    if (state.timerRunning) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
        state.timerRunning = false;
        $("timer-start").textContent = "Resume";
        $("timer-status").textContent = "Timer paused.";
        return;
    }

    if (state.timerSeconds <= 0) resetTimer();

    state.timerRunning = true;
    $("timer-start").textContent = "Pause";
    $("timer-status").textContent = "Stay focused. You've got this!";

    state.timerInterval = setInterval(async () => {
        state.timerSeconds--;
        updateTimerDisplay();

        if (state.timerSeconds <= 0) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
            state.timerRunning = false;
            $("timer-start").textContent = "Start";
            $("timer-status").textContent = "Session finished! Well done.";

            const isFocus = state.timerInitial > 5 * 60;
            try {
                if (isFocus) {
                    await recordStudyMinutes(
                        Math.round(state.timerInitial / 60)
                    );
                    showToast("Study session complete! Progress updated.");
                } else {
                    showToast("Break finished. Ready for another session?");
                }
            } catch (error) {
                showToast(error.message);
            }
        }
    }, 1000);
});

$("timer-reset").addEventListener("click", resetTimer);

// Export task list to CSV
$("export-tasks").addEventListener("click", () => {
    if (!state.tasks.length) {
        showToast("There are no tasks to export.");
        return;
    }

    const columns = [
        "title", "subject", "task_type", "due_date",
        "priority", "status", "description"
    ];

    const quoteCSV = value =>
        '"' + String(value ?? "").replace(/"/g, '""') + '"';

    const csv = [
        columns.join(","),
        ...state.tasks.map(task =>
            columns.map(column => quoteCSV(task[column])).join(",")
        )
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "StudyMate_Tasks.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Task export started.");
});

// Start the application
async function startApp() {
    $("today-date").textContent = new Date().toLocaleDateString(
        "en-IN", { day: "numeric", month: "short" }
    );

    try {
        await refreshData();
        updateTimerDisplay();
    } catch (error) {
        showToast("Could not load data. Check that Flask is running.");
        console.error(error);
    }
}

startApp();
