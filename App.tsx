import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storageKey = 'habit-tracker-native-state';
const loginCredentialsKey = 'habit-tracker-login-credentials';
const cloudBackendUrl = 'https://habit-tracker-vclo.onrender.com';
const dayMs = 24 * 60 * 60 * 1000;
const categories = ['Fitness', 'Study', 'Health', 'Nutrition', 'Mindfulness'];
const DeviceStorage = AsyncStorage;
const frequencies = ['Daily', 'Weekdays', 'Weekly', 'Custom'];
const statuses = ['Active', 'Paused', 'Archived'];

type Account = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

type Habit = {
  id: string;
  userId: string | null;
  name: string;
  description: string;
  frequency: string;
  reminder: string;
  category: string;
  status: string;
  createdAt: string;
};

type Completion = {
  id: string;
  userId: string | null;
  habitId: string;
  date: string;
  status: string;
};

type AppState = {
  currentUserId: string | null;
  accounts: Account[];
  habits: Habit[];
  completions: Completion[];
};

const initialState: AppState = {
  currentUserId: null,
  accounts: [],
  habits: [],
  completions: []
};

function loadSavedState(saved: string): AppState {
  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    return {
      currentUserId: typeof parsed.currentUserId === 'string' ? parsed.currentUserId : null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      completions: Array.isArray(parsed.completions) ? parsed.completions : []
    };
  } catch {
    return initialState;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const dateOffset = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function hashPassword(password: string) {
  let hash = 0;
  for (let i = 0; i < password.length; i += 1) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return `hash-${Math.abs(hash)}`;
}

export default function App() {
  return (
    <>
      <StatusBar barStyle="dark-content" />
      <AppContent />
    </>
  );
}

type AuthForm = {
  name: string;
  email: string;
  password: string;
};

function AppContent() {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState<AuthForm>({ name: '', email: '', password: '' });
  const [authMessage, setAuthMessage] = useState('');
  const [tab, setTab] = useState<'Overview' | 'Habits' | 'Analytics' | 'Sync'>('Overview');
  const [range, setRange] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  const [habitQuery, setHabitQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | string>('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [habitForm, setHabitForm] = useState<Habit>(emptyHabit());
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [restoreJson, setRestoreJson] = useState('');
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudStatus, setCloudStatus] = useState('Idle');
  const initialSyncDone = useRef(false);
  const skipAutoUploadAfterDownload = useRef(false);
  const firstStateSyncSkipped = useRef(false);
  const syncInProgress = useRef(false);
  const pendingUpload = useRef(false);
  const syncDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await DeviceStorage.getItem(storageKey);
      if (saved) {
        setState({ ...initialState, ...loadSavedState(saved) });
      }
      
      const credentials = await DeviceStorage.getItem(loginCredentialsKey);
      if (credentials && !saved) {
        setReady(true);
        return;
      }
      
      if (credentials && saved) {
        try {
          const creds = JSON.parse(credentials) as { email: string; passwordHash: string };
          const response = await fetch(`${cloudBackendUrl.replace(/\/$/, '')}/cloud/${encodeURIComponent(creds.email)}?passwordHash=${encodeURIComponent(creds.passwordHash)}`);
          if (response.ok) {
            const remote = await response.json();
            if (remote && remote.state) {
              const restoredState = { ...initialState, ...remote.state };
              setState(restoredState);
              initialSyncDone.current = true;
            }
          }
        } catch {
          // Silent fail, use local state
        }
      }
      
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) {
      DeviceStorage.setItem(storageKey, JSON.stringify(state));
    }
  }, [state, ready]);

  useEffect(() => {
    if (!ready || !state.currentUserId || initialSyncDone.current) return;
    const account = state.accounts.find((account) => account.id === state.currentUserId);
    if (!account) {
      initialSyncDone.current = true;
      return;
    }
    initialSyncDone.current = true;
    downloadCloudFor(account.email, account.passwordHash, false);
  }, [ready, state.currentUserId]);

  useEffect(() => {
    if (!ready || !state.currentUserId) return;
    if (!firstStateSyncSkipped.current) {
      firstStateSyncSkipped.current = true;
      return;
    }
    if (skipAutoUploadAfterDownload.current) {
      skipAutoUploadAfterDownload.current = false;
      return;
    }
    
    if (syncDebounceTimer.current) {
      clearTimeout(syncDebounceTimer.current);
    }
    
    syncDebounceTimer.current = setTimeout(() => {
      uploadCloud();
    }, 1000);
  }, [state, ready, state.currentUserId]);

  const user = state.accounts.find((account) => account.id === state.currentUserId);
  const userHabits = state.habits.filter((habit) => habit.userId === state.currentUserId);
  const visibleHabits = userHabits.filter((habit) => habit.status !== 'Archived');
  const activeHabits = visibleHabits.filter((habit) => habit.status === 'Active');
  const filteredHabits = userHabits.filter((habit) => {
    const query = habitQuery.trim().toLowerCase();
    const matchesQuery = !query || habit.name.toLowerCase().includes(query) || habit.description.toLowerCase().includes(query);
    const matchesCategory = categoryFilter === 'All' || habit.category === categoryFilter;
    return matchesQuery && matchesCategory;
  });

  const metrics = useMemo(() => {
    const todayRate = completionRate(state, activeHabits, [today()]);
    const weekRate = completionRate(state, activeHabits, datesForRange('Weekly'));
    const bestStreak = Math.max(0, ...activeHabits.map((habit) => longestStreakFor(state, habit.id, habit.userId)));
    return { todayRate, weekRate, bestStreak, activeCount: activeHabits.length };
  }, [state, activeHabits.length]);

  async function fetchCloudState(email: string, passwordHash: string) {
    try {
      const response = await fetch(`${cloudBackendUrl.replace(/\/$/, '')}/cloud/${encodeURIComponent(email)}?passwordHash=${encodeURIComponent(passwordHash)}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Cloud fetch failed');
      }
      return await response.json();
    } catch (error) {
      throw new Error((error as Error).message || 'Cloud fetch failed');
    }
  }

  async function uploadCloud(overrideState?: AppState) {
    const uploadState = overrideState ?? state;
    if (!uploadState.currentUserId) {
      Alert.alert('Login required', 'Sign in before syncing your data.');
      return;
    }
    const user = uploadState.accounts.find((account) => account.id === uploadState.currentUserId);
    if (!user) {
      Alert.alert('User not found', 'Please log in again.');
      return;
    }

    if (syncInProgress.current) {
      pendingUpload.current = true;
      setCloudStatus('Queued upload');
      setCloudMessage('A sync is already running. Upload will happen automatically shortly.');
      return;
    }

    syncInProgress.current = true;
    setCloudStatus('Uploading');
    try {
      setCloudMessage('Uploading to cloud...');
      const response = await fetch(`${cloudBackendUrl.replace(/\/$/, '')}/cloud/${encodeURIComponent(user.email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: uploadState, passwordHash: user.passwordHash })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Cloud upload failed');
      }
      const result = await response.json();
      setCloudMessage(result.message || 'Uploaded successfully.');
      setCloudStatus('Up to date');
      if (user && authForm.email.trim().toLowerCase() !== user.email) {
        setAuthForm((current) => ({ ...current, email: user.email }));
      }
    } catch (error) {
      const message = (error as Error).message || 'Upload failed';
      setCloudMessage(message);
      setCloudStatus('Upload failed');
      pendingUpload.current = true;
    } finally {
      syncInProgress.current = false;
      if (pendingUpload.current) {
        pendingUpload.current = false;
        uploadCloud();
      }
    }
  }

  async function downloadCloudFor(email: string, passwordHash: string, showAlerts = true) {
    try {
      if (showAlerts) setCloudMessage('Downloading from cloud...');
      const remote = await fetchCloudState(email, passwordHash);
      if (!remote || !remote.state) {
        throw new Error('No cloud data available.');
      }
      skipAutoUploadAfterDownload.current = true;
      setState((current) => ({ ...initialState, ...remote.state }));
      if (showAlerts) {
        setCloudMessage('Download complete.');
        Alert.alert('Cloud sync', 'Your data was restored from the cloud.');
      }
      return true;
    } catch (error) {
      const message = (error as Error).message || 'Download failed';
      setCloudMessage(message);
      if (showAlerts) Alert.alert('Cloud download failed', message);
      return false;
    }
  }

  async function downloadCloud() {
    if (!authForm.email.trim() || !authForm.password) {
      Alert.alert('Enter email and password', 'Type the email and password for the account you want to restore.');
      return;
    }
    const email = authForm.email.trim().toLowerCase();
    const passwordHash = hashPassword(authForm.password);
    await downloadCloudFor(email, passwordHash, true);
  }

  async function submitAuth() {
    const email = authForm.email.trim().toLowerCase();
    const password = authForm.password;
    if (!email || password.length < 6) {
      setAuthMessage('Use an email and a password with at least 6 characters.');
      return;
    }

    const passwordHash = hashPassword(password);
    const existing = state.accounts.find((account) => account.email === email);

    if (authMode === 'register') {
      if (existing) {
        setAuthMessage('Account exists — use login for this email.');
        return;
      }
      const account = {
        id: uid(),
        name: authForm.name.trim() || email.split('@')[0],
        email,
        passwordHash,
        createdAt: new Date().toISOString()
      } as const;
      setState((current) => {
        const next = seedDemoData({ ...current, accounts: [...current.accounts, account], currentUserId: account.id }, account.id);
        (async () => {
          setCloudMessage('Creating account and uploading to cloud...');
          await uploadCloud(next);
        })();
        return next;
      });
      await DeviceStorage.setItem(loginCredentialsKey, JSON.stringify({ email, passwordHash }));
      setAuthForm({ name: '', email: '', password: '' });
      return;
    }

    if (existing && existing.passwordHash === passwordHash) {
      setState((current) => ({ ...seedDemoData(current, existing.id), currentUserId: existing.id }));
      await DeviceStorage.setItem(loginCredentialsKey, JSON.stringify({ email, passwordHash }));
      setAuthForm({ name: '', email: '', password: '' });
      await downloadCloudFor(email, passwordHash, false);
      return;
    }

    try {
      const remote = await fetchCloudState(email, passwordHash);
      if (remote && remote.state) {
        const restoredState = { ...initialState, ...remote.state };
        const restoredAccount = restoredState.accounts.find((account) => account.email === email);
        const nextState = restoredAccount ? { ...restoredState, currentUserId: restoredAccount.id } : restoredState;
        setState(nextState);
        await DeviceStorage.setItem(loginCredentialsKey, JSON.stringify({ email, passwordHash }));
        setAuthForm({ name: '', email: '', password: '' });
        if (!restoredAccount) {
          setCloudMessage('Cloud data restored, but no matching account was found locally.');
        }
        return;
      }
    } catch (error) {
      const errorMsg = (error as Error).message || 'Unknown error';
      setAuthMessage(errorMsg + '\nIf this is your first login, create a new account.');
      return;
    }

    setAuthMessage('Login failed — check your email and password.');
  }

  function saveHabit() {
    if (!habitForm.name.trim()) {
      Alert.alert('Habit name required', 'Give the habit a short name.');
      return;
    }

    const habit = {
      ...habitForm,
      id: habitForm.id || uid(),
      userId: state.currentUserId,
      createdAt: habitForm.createdAt || new Date().toISOString()
    };

    setState((current) => ({
      ...current,
      habits: habitForm.id
        ? current.habits.map((item) => (item.id === habitForm.id ? habit : item))
        : [...current.habits, habit]
    }));
    setModalOpen(false);
    setHabitForm(emptyHabit());
  }

  function toggleComplete(habitId: string) {
    const index = state.completions.findIndex((entry) =>
      entry.userId === state.currentUserId && entry.habitId === habitId && entry.date === today()
    );
    if (index >= 0) {
      setState({
        ...state,
        completions: state.completions.filter((_, itemIndex) => itemIndex !== index)
      });
    } else {
      setState({
        ...state,
        completions: [...state.completions, { id: uid(), userId: state.currentUserId, habitId, date: today(), status: 'Completed' }]
      });
    }
  }

  function updateHabitStatus(id: string, status: string) {
    setState({
      ...state,
      habits: state.habits.map((habit) => habit.id === id ? { ...habit, status } : habit)
    });
  }

  function deleteHabit(id: string) {
    Alert.alert('Delete habit', 'This permanently deletes the habit and its progress.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setState({
          ...state,
          habits: state.habits.filter((habit) => habit.id !== id),
          completions: state.completions.filter((entry) => entry.habitId !== id)
        })
      }
    ]);
  }

  if (!ready) {
    return (
      <Screen>
        <Text style={styles.title}>Loading...</Text>
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>Habit tracking app</Text>
        <Text style={styles.heroTitle}>Build steady routines.</Text>
        <Text style={styles.muted}>Register, create habits, mark completion, and view streaks.</Text>

        <View style={styles.segmented}>
          {(['login', 'register'] as const).map((mode) => (
            <Pressable
              key={mode}
              style={[styles.segment, authMode === mode && styles.segmentActive]}
              onPress={() => setAuthMode(mode)}
            >
              <Text style={[styles.segmentText, authMode === mode && styles.segmentTextActive]}>{capitalize(mode)}</Text>
            </Pressable>
          ))}
        </View>

        {authMode === 'register' && (
          <Field label="Name" value={authForm.name} onChangeText={(name) => { setAuthForm({ ...authForm, name }); setAuthMessage(''); }} />
        )}
        <Field label="Email" value={authForm.email} autoCapitalize="none" keyboardType="email-address" onChangeText={(email) => { setAuthForm({ ...authForm, email }); setAuthMessage(''); }} />
        <Field label="Password" value={authForm.password} secureTextEntry onChangeText={(password) => { setAuthForm({ ...authForm, password }); setAuthMessage(''); }} />
        {!!authMessage && <Text style={styles.authError}>{authMessage}</Text>}
        <Button title={authMode === 'login' ? 'Login' : 'Create account'} onPress={submitAuth} />
      </Screen>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
          <Text style={styles.title}>Hi, {user.name}</Text>
        </View>
        <Pressable style={styles.logoutButton} onPress={() => {
          setState({ ...state, currentUserId: null });
          DeviceStorage.removeItem(loginCredentialsKey);
        }}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {(['Overview', 'Habits', 'Analytics', 'Sync'] as const).map((item) => (
          <Pressable key={item} style={[styles.tab, tab === item && styles.tabActive]} onPress={() => setTab(item)}>
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'Overview' && (
          <>
            <View style={styles.metricGrid}>
              <Metric label="Today" value={`${metrics.todayRate}%`} hint="completion" />
              <Metric label="Weekly" value={`${metrics.weekRate}%`} hint="completion" />
              <Metric label="Best streak" value={metrics.bestStreak} hint="days" />
              <Metric label="Active" value={metrics.activeCount} hint="habits" />
            </View>
            <SectionTitle title="Today" action="+ New" onPress={() => { setHabitForm(emptyHabit()); setModalOpen(true); }} />
            {activeHabits.length ? activeHabits.map((habit) => (
              <HabitRow key={habit.id} habit={habit} state={state} onComplete={() => toggleComplete(habit.id)} />
            )) : <Empty text="Create your first habit to start tracking today." />}
          </>
        )}

        {tab === 'Habits' && (
          <>
            <SectionTitle title="Habit management" action="+ New" onPress={() => { setHabitForm(emptyHabit()); setModalOpen(true); }} />
            <Field label="Search habits" value={habitQuery} onChangeText={setHabitQuery} />
            <OptionGroup
              label="Category"
              options={['All', ...categories]}
              value={categoryFilter}
              onChange={(category) => setCategoryFilter(category)}
            />
            {filteredHabits.length ? filteredHabits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                onEdit={() => { setHabitForm(habit); setModalOpen(true); }}
                onPause={() => updateHabitStatus(habit.id, habit.status === 'Paused' ? 'Active' : 'Paused')}
                onArchive={() => updateHabitStatus(habit.id, habit.status === 'Archived' ? 'Active' : 'Archived')}
                onDelete={() => deleteHabit(habit.id)}
              />
            )) : <Empty text="No habits match your search/filter." />}
          </>
        )}

        {tab === 'Analytics' && (
          <>
            <SectionTitle title="Reports and statistics" />
            <View style={styles.segmented}>
              {(['Daily', 'Weekly', 'Monthly'] as const).map((item) => (
                <Pressable key={item} style={[styles.segment, range === item && styles.segmentActive]} onPress={() => setRange(item)}>
                  <Text style={[styles.segmentText, range === item && styles.segmentTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>
            <Chart state={state} habits={activeHabits} range={range} />
            {activeHabits.map((habit) => (
              <View key={habit.id} style={styles.streakLine}>
                <Text style={styles.cardTitle}>{habit.name}</Text>
                <Text style={styles.muted}>{streakFor(state, habit.id, habit.userId)} current / {longestStreakFor(state, habit.id, habit.userId)} best</Text>
              </View>
            ))}
          </>
        )}

        {tab === 'Sync' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Device storage</Text>
              <Text style={styles.muted}>Your data is stored locally on this device. You can export backup JSON to restore after reinstall or on another device.</Text>
              <View style={styles.actionRow}>
                <Button title="Export backup" variant="light" onPress={() => {
                  const payload = { state, exportedAt: new Date().toISOString() };
                  setBackupJson(JSON.stringify(payload, null, 2));
                  setBackupOpen(true);
                }} />
                <Button title="Restore backup" variant="light" onPress={() => {
                  setRestoreJson('');
                  setRestoreOpen(true);
                }} />
              </View>
              <View style={styles.actionRow}>
                <Button title="Restore samples" variant="light" onPress={() => {
                  if (!state.currentUserId) return;
                  setState((current) => seedDemoData(current, current.currentUserId!));
                }} />
                <Button title="Reset data" variant="light" onPress={() => {
                  Alert.alert('Reset app data', 'This clears all local data and logs you out.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reset', style: 'destructive', onPress: () => setState(initialState) }
                  ]);
                }} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cloud sync</Text>
              <Text style={styles.muted}>Your data automatically syncs to the cloud and restores when you log in on a new device.</Text>
              <View style={styles.actionRow}>
                <Button title="Upload to cloud" variant="light" onPress={uploadCloud} />
                <Button title="Download from cloud" variant="light" onPress={downloadCloud} />
              </View>
              <Text style={styles.cloudNote}>Status: {cloudStatus}</Text>
              {!!cloudMessage && <Text style={styles.cloudStatus}>{cloudMessage}</Text>}
            </View>
          </>
        )}
      </ScrollView>

      {/* Non-blocking cloud activity indicator in the corner */}
      {(cloudStatus === 'Uploading' || cloudMessage.toLowerCase().includes('upload') || cloudMessage.toLowerCase().includes('download')) && (
        <View style={styles.cloudIndicator} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}

      <HabitModal
        visible={modalOpen}
        form={habitForm}
        setForm={setHabitForm}
        onCancel={() => setModalOpen(false)}
        onSave={saveHabit}
      />
      <Modal visible={backupOpen} animationType="slide">
        <SafeAreaView style={styles.safe}>
          <View style={styles.content}>
            <SectionTitle title="Export backup" action="Close" onPress={() => setBackupOpen(false)} />
            <Text style={styles.muted}>Copy this JSON and save it somewhere safe. You can paste it on another device or after reinstalling.</Text>
            <TextInput
              style={[styles.input, styles.backupText]}
              multiline
              editable={false}
              value={backupJson}
              textAlignVertical="top"
            />
            <Button title="Close" onPress={() => setBackupOpen(false)} />
          </View>
        </SafeAreaView>
      </Modal>
      <Modal visible={restoreOpen} animationType="slide">
        <SafeAreaView style={styles.safe}>
          <View style={styles.content}>
            <SectionTitle title="Restore backup" action="Close" onPress={() => setRestoreOpen(false)} />
            <Text style={styles.muted}>Paste backup JSON from another device or a saved copy, then tap Restore.</Text>
            <TextInput
              style={[styles.input, styles.backupText]}
              multiline
              value={restoreJson}
              onChangeText={setRestoreJson}
              textAlignVertical="top"
              placeholder="Paste backup JSON here"
              placeholderTextColor="#89928e"
            />
            <View style={styles.actionRow}>
              <Button title="Restore" onPress={() => {
                try {
                  const payload = JSON.parse(restoreJson.trim());
                  const nextState = payload.state ?? payload;
                  setState({ ...initialState, ...nextState });
                  setRestoreOpen(false);
                  Alert.alert('Backup restored', 'Your data has been imported successfully.');
                } catch (error) {
                  Alert.alert('Invalid backup', 'Please check the JSON and try again.');
                }
              }} />
              <Button title="Cancel" variant="light" onPress={() => setRestoreOpen(false)} />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function emptyHabit() {
  return {
    id: '',
    name: '',
    description: '',
    frequency: 'Daily',
    reminder: '08:00',
    category: 'Fitness',
    status: 'Active',
    userId: '' as string,
    createdAt: ''
  };
}

function seedDemoData(nextState: typeof initialState, userId: string) {
  if (nextState.habits.some((habit) => habit.userId === userId)) return nextState;
  const samples = [
    ['Morning walk', 'Walk for at least 20 minutes.', 'Daily', '07:30', 'Fitness'],
    ['Read lecture notes', 'Review one programming topic.', 'Weekdays', '18:00', 'Study'],
    ['Drink water', 'Track hydration during the day.', 'Daily', '10:00', 'Health']
  ] as const;

  const habits = [] as Array<any>;
  const completions = [] as Array<any>;

  samples.forEach(([name, description, frequency, reminder, category], index) => {
    const habitId = uid();
    habits.push({ id: habitId, userId, name, description, frequency, reminder, category, status: 'Active', createdAt: new Date(Date.now() - index * dayMs).toISOString() });
    for (let day = 0; day < 7; day += 1) {
      if ((day + index) % 3 !== 0) {
        completions.push({ id: uid(), userId, habitId, date: dateOffset(day), status: 'Completed' });
      }
    }
  });

  return { ...nextState, habits: [...nextState.habits, ...habits], completions: [...nextState.completions, ...completions] };
}

function isComplete(state: typeof initialState, habitId: string, userId: string | null, date = today()) {
  return state.completions.some((entry) => entry.userId === userId && entry.habitId === habitId && entry.date === date);
}

function datesForRange(range: 'Daily' | 'Weekly' | 'Monthly') {
  const count = range === 'Monthly' ? 30 : range === 'Weekly' ? 7 : 1;
  return Array.from({ length: count }, (_, index) => dateOffset(count - 1 - index));
}

function completionRate(state: typeof initialState, habits: Array<any>, dates: string[]) {
  if (!habits.length || !dates.length) return 0;
  const completed = habits.reduce((sum, habit) => sum + dates.filter((date) => isComplete(state, habit.id, habit.userId, date)).length, 0);
  return Math.round((completed / (habits.length * dates.length)) * 100);
}

function streakFor(state: typeof initialState, habitId: string, userId: string | null) {
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    if (!isComplete(state, habitId, userId, dateOffset(i))) break;
    streak += 1;
  }
  return streak;
}

function longestStreakFor(state: typeof initialState, habitId: string, userId: string | null) {
  const dates = state.completions
    .filter((entry) => entry.userId === userId && entry.habitId === habitId)
    .map((entry) => entry.date)
    .sort();

  let best = 0;
  let current = 0;
  let previous: number | null = null;

  dates.forEach((date) => {
    const time = new Date(date).getTime();
    current = previous && time - previous === dayMs ? current + 1 : 1;
    best = Math.max(best, current);
    previous = time;
  });

  return best;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.authContent}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#89928e" {...props} />
    </View>
  );
}

function Button({ title, onPress, variant }: { title: string; onPress: () => void; variant?: 'light' }) {
  return (
    <Pressable style={[styles.button, variant === 'light' && styles.lightButton]} onPress={onPress}>
      <Text style={[styles.buttonText, variant === 'light' && styles.lightButtonText]}>{title}</Text>
    </Pressable>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.muted}>{hint}</Text>
    </View>
  );
}

function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionText}>{title}</Text>
      {action ? (
        <Pressable onPress={onPress}>
          <Text style={styles.actionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function HabitRow({ habit, state, onComplete }: { habit: any; state: typeof initialState; onComplete: () => void }) {
  const done = isComplete(state, habit.id, habit.userId);
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{habit.name}</Text>
        <Pressable style={[styles.smallButton, done && styles.doneButton]} onPress={onComplete}>
          <Text style={[styles.smallButtonText, done && styles.doneButtonText]}>{done ? 'Completed' : 'Mark done'}</Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>{habit.description || 'No description added.'}</Text>
      <Pills values={[habit.category, habit.frequency, habit.reminder, `${streakFor(state, habit.id, habit.userId)} day streak`]} />
    </View>
  );
}

function HabitCard({ habit, onEdit, onPause, onArchive, onDelete }: { habit: any; onEdit: () => void; onPause: () => void; onArchive: () => void; onDelete: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{habit.name}</Text>
        <Text style={styles.pill}>{habit.status}</Text>
      </View>
      <Text style={styles.muted}>{habit.description || 'No description added.'}</Text>
      <Pills values={[habit.category, habit.frequency, habit.reminder]} />
      <View style={styles.actionRow}>
        <Button title="Edit" variant="light" onPress={onEdit} />
        <Button title={habit.status === 'Paused' ? 'Resume' : 'Pause'} variant="light" onPress={onPause} />
        <Button title={habit.status === 'Archived' ? 'Restore' : 'Archive'} variant="light" onPress={onArchive} />
        <Button title="Delete" variant="light" onPress={onDelete} />
      </View>
    </View>
  );
}

function Pills({ values }: { values: string[] }) {
  return (
    <View style={styles.pillRow}>
      {values.map((value) => (
        <Text key={value} style={styles.pill}>{value}</Text>
      ))}
    </View>
  );
}

function Chart({ state, habits, range }: { state: typeof initialState; habits: Array<any>; range: 'Daily' | 'Weekly' | 'Monthly' }) {
  const dates = datesForRange(range);
  return (
    <View style={styles.chart}>
      {dates.map((date) => {
        const rate = completionRate(state, habits, [date]);
        return (
          <View key={date} style={styles.chartItem}>
            <Text style={styles.chartValue}>{rate}%</Text>
            <View style={[styles.chartBar, { height: Math.max(8, rate * 1.6) }]} />
            <Text style={styles.chartLabel}>{range === 'Monthly' ? new Date(date).getDate() : new Date(date).toLocaleDateString(undefined, { weekday: 'short' })}</Text>
          </View>
        );
      })}
    </View>
  );
}

function HabitModal({ visible, form, setForm, onCancel, onSave }: { visible: boolean; form: any; setForm: (form: any) => void; onCancel: () => void; onSave: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <SectionTitle title={form.id ? 'Edit habit' : 'New habit'} action="Close" onPress={onCancel} />
          <Field label="Habit name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
          <Field label="Description" value={form.description} onChangeText={(description) => setForm({ ...form, description })} />
          <Field label="Reminder time" value={form.reminder} onChangeText={(reminder) => setForm({ ...form, reminder })} />
          <OptionGroup label="Frequency" options={frequencies} value={form.frequency} onChange={(frequency) => setForm({ ...form, frequency })} />
          <OptionGroup label="Category" options={categories} value={form.category} onChange={(category) => setForm({ ...form, category })} />
          <OptionGroup label="Status" options={statuses} value={form.status} onChange={(status) => setForm({ ...form, status })} />
          <Button title="Save habit" onPress={onSave} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OptionGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((option) => (
          <Pressable key={option} style={[styles.option, value === option && styles.optionActive]} onPress={() => onChange(option)}>
            <Text style={[styles.optionText, value === option && styles.optionTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f7f5ef'
  },
  authContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22
  },
  content: {
    padding: 18,
    paddingBottom: 38
  },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#dfe4df',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  eyebrow: {
    color: '#245c49',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  heroTitle: {
    color: '#1d2322',
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '900'
  },
  title: {
    color: '#1d2322',
    fontSize: 28,
    fontWeight: '900'
  },
  muted: {
    color: '#68716e',
    lineHeight: 20
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#edf2ef',
    borderRadius: 10,
    padding: 4,
    marginVertical: 18
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  segmentActive: {
    backgroundColor: '#fff'
  },
  segmentText: {
    color: '#68716e',
    fontWeight: '800'
  },
  segmentTextActive: {
    color: '#245c49'
  },
  field: {
    marginBottom: 16
  },
  label: {
    color: '#34413e',
    fontWeight: '800',
    marginBottom: 6
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#dfe4df',
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    color: '#1d2322'
  },
  button: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#2f7d5c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 10
  },
  buttonText: {
    color: '#fff',
    fontWeight: '900'
  },
  lightButton: {
    minHeight: 38,
    backgroundColor: '#e9f1ec'
  },
  lightButtonText: {
    color: '#245c49'
  },
  logoutButton: {
    backgroundColor: '#e9f1ec',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9
  },
  logoutText: {
    color: '#245c49',
    fontWeight: '900'
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: '#fff'
  },
  tab: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center'
  },
  tabActive: {
    backgroundColor: '#2f7d5c'
  },
  tabText: {
    color: '#68716e',
    fontSize: 12,
    fontWeight: '900'
  },
  tabTextActive: {
    color: '#fff'
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  metric: {
    width: Platform.OS === 'web' ? '23%' : '47%',
    minHeight: 102,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe4df',
    backgroundColor: '#fff',
    marginBottom: 10
  },
  metricLabel: {
    color: '#68716e',
    fontWeight: '800'
  },
  metricValue: {
    marginTop: 6,
    color: '#1d2322',
    fontSize: 28,
    fontWeight: '900'
  },
  sectionTitle: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sectionText: {
    color: '#1d2322',
    fontSize: 20,
    fontWeight: '900'
  },
  actionText: {
    color: '#2f7d5c',
    fontWeight: '900'
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe4df',
    backgroundColor: '#fff',
    marginBottom: 12
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  cardTitle: {
    flex: 1,
    color: '#1d2322',
    fontSize: 16,
    fontWeight: '900'
  },
  smallButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#dfe4df',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  smallButtonText: {
    color: '#34413e',
    fontWeight: '900'
  },
  doneButton: {
    borderColor: '#2f7d5c',
    backgroundColor: '#2f7d5c'
  },
  doneButtonText: {
    color: '#fff'
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  pill: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: '#34413e',
    backgroundColor: '#edf2ef',
    fontSize: 12,
    fontWeight: '800'
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chart: {
    minHeight: 240,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe4df',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginBottom: 12
  },
  chartItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5
  },
  chartBar: {
    width: '72%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: '#356b95'
  },
  chartValue: {
    color: '#68716e',
    fontSize: 10,
    fontWeight: '800'
  },
  chartLabel: {
    color: '#68716e',
    fontSize: 10,
    fontWeight: '800'
  },
  streakLine: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dfe4df',
    marginBottom: 12
  },
  backupText: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#edf2ef',
    color: '#34413e',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11
  },
  cloudNote: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12
  },
  cloudStatus: {
    marginTop: 10,
    color: '#245c49',
    fontWeight: '700'
  },
  cloudIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 8,
    borderRadius: 12,
    zIndex: 1000
  },
  authError: {
    marginTop: 10,
    color: '#b00020',
    fontWeight: '700'
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  option: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#edf2ef'
  },
  optionActive: {
    backgroundColor: '#2f7d5c'
  },
  optionText: {
    color: '#34413e',
    fontWeight: '800'
  },
  optionTextActive: {
    color: '#fff'
  },
  empty: {
    padding: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd4cf',
    backgroundColor: '#fff',
    alignItems: 'center'
  }
});
