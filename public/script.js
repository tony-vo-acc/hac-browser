const loginBtn = document.getElementById('login-btn');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginErrorDiv = document.getElementById('login-error');

const scheduleForm = document.getElementById('schedule-form');
const dateInput = document.getElementById('date');
const fetchScheduleBtn = document.getElementById('fetch-schedule-btn');
const scheduleErrorDiv = document.getElementById('schedule-error');
const scheduleTable = document.getElementById('schedule-table');
const scheduleTableBody = scheduleTable.querySelector('tbody');

loginBtn.addEventListener('click', async () => {
  loginErrorDiv.textContent = '';
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    loginErrorDiv.textContent = 'Please enter username and password.';
    return;
  }

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      loginErrorDiv.textContent = data.error || 'Login failed';
      return;
    }

    // Login success
    document.getElementById('login-form').style.display = 'none';
    scheduleForm.style.display = 'block';

    // Optional: default date today
    dateInput.valueAsDate = new Date();
  } catch (err) {
    loginErrorDiv.textContent = 'Network error during login';
  }
});

fetchScheduleBtn.addEventListener('click', async () => {
  scheduleErrorDiv.textContent = '';
  scheduleTable.style.display = 'none';
  scheduleTableBody.innerHTML = '';

  const date = dateInput.value;
  if (!date) {
    scheduleErrorDiv.textContent = 'Please select a date.';
    return;
  }

  try {
    const res = await fetch('/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });

    if (!res.ok) {
      const data = await res.json();
      scheduleErrorDiv.textContent = data.error || 'Failed to fetch schedule';
      return;
    }

    const { schedule } = await res.json();

    if (!schedule.length) {
      scheduleErrorDiv.textContent = 'No schedule entries found for that date.';
      return;
    }

    for (const item of schedule) {
      const row = document.createElement('tr');
      for (const key of ['period', 'course', 'description', 'teacher', 'room']) {
        const td = document.createElement('td');
        td.textContent = item[key];
        row.appendChild(td);
      }
      scheduleTableBody.appendChild(row);
    }

    scheduleTable.style.display = 'table';
  } catch (err) {
    scheduleErrorDiv.textContent = 'Network error while fetching schedule';
  }
});
