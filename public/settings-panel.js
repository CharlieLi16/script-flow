import {
  checkTeamSession,
  clearEncryptedKeys,
  decryptKeys,
  encryptKeys,
  getKeyMode,
  getMemoryKeys,
  initSettings,
  setKeyMode,
  setMemoryKeys,
  unlockTeam,
} from './settings.js';

export function mountSettingsPanel(container) {
  container.innerHTML = `
    <button type="button" id="settings-btn" class="btn btn-ghost btn-sm" title="设置">⚙ 设置</button>
  `;

  const overlay = document.createElement('div');
  overlay.id = 'settings-overlay';
  overlay.className = 'modal-overlay settings-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header">
        <h3 id="settings-title">API 与访问设置</h3>
        <button type="button" id="settings-close" class="btn-icon" aria-label="关闭">×</button>
      </header>
      <div class="settings-body">
        <section>
          <h4>Key 模式</h4>
          <label class="settings-radio"><input type="radio" name="key-mode" value="personal" /> 个人 Key（BYOK）</label>
          <label class="settings-radio"><input type="radio" name="key-mode" value="team" /> 团队共享 Key</label>
        </section>
        <section id="team-section">
          <h4>团队访问码</h4>
          <div class="settings-row">
            <input type="password" id="team-code-input" placeholder="输入团队访问码" autocomplete="off" />
            <button type="button" id="team-unlock-btn" class="btn btn-primary btn-sm">解锁</button>
          </div>
          <p id="team-status" class="settings-hint">未解锁团队 Key</p>
        </section>
        <section id="personal-section">
          <h4>个人 API Key</h4>
          <label>OpenAI API Key<input type="password" id="openai-key-input" autocomplete="off" /></label>
          <label>Gemini API Key<input type="password" id="gemini-key-input" autocomplete="off" /></label>
          <label class="settings-checkbox">
            <input type="checkbox" id="remember-keys" /> 记住此设备（口令加密）
          </label>
          <input type="password" id="key-passphrase" placeholder="加密口令（仅记住时填写）" hidden autocomplete="new-password" />
        </section>
        <p id="settings-status" class="settings-hint" hidden></p>
        <p class="settings-security-note">API Key 不会写入 ZIP 导出文件。团队访问码请勿公开分享。</p>
      </div>
      <div class="modal-actions settings-actions">
        <button type="button" id="settings-cancel" class="btn btn-ghost">取消</button>
        <button type="button" id="settings-save" class="btn btn-primary">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const panel = overlay;
  const teamStatus = overlay.querySelector('#team-status');
  const statusEl = overlay.querySelector('#settings-status');
  const passphraseInput = overlay.querySelector('#key-passphrase');

  function showStatus(message, isError = false) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', isError);
  }

  function openPanel() {
    overlay.hidden = false;
    showStatus('');
    syncUi();
    overlay.querySelector('#openai-key-input')?.focus();
  }

  function closePanel() {
    overlay.hidden = true;
    showStatus('');
  }

  function syncUi() {
    const mode = getKeyMode();
    overlay.querySelectorAll('input[name="key-mode"]').forEach((el) => {
      el.checked = el.value === mode;
    });
    overlay.querySelector('#team-section').hidden = mode !== 'team';
    overlay.querySelector('#personal-section').hidden = mode === 'team';
    const keys = getMemoryKeys();
    overlay.querySelector('#openai-key-input').value = keys.openai;
    overlay.querySelector('#gemini-key-input').value = keys.gemini;
    overlay.querySelector('#remember-keys').checked = false;
    passphraseInput.hidden = true;
    passphraseInput.value = '';
    checkTeamSession().then((ok) => {
      teamStatus.textContent = ok ? '团队 Key 已解锁（7 天内有效）' : '未解锁团队 Key';
    });
  }

  async function saveSettings() {
    showStatus('');
    const mode = getKeyMode();
    if (mode === 'personal') {
      const openai = overlay.querySelector('#openai-key-input').value.trim();
      const gemini = overlay.querySelector('#gemini-key-input').value.trim();
      if (!openai && !gemini) {
        showStatus('请至少填写一个 API Key', true);
        return;
      }
      setMemoryKeys({ openai, gemini });
      const remember = overlay.querySelector('#remember-keys').checked;
      if (remember) {
        const passphrase = passphraseInput.value.trim();
        if (!passphrase) {
          showStatus('勾选记住此设备时，请填写加密口令', true);
          return;
        }
        try {
          await encryptKeys({ openai, gemini }, passphrase);
        } catch (err) {
          showStatus(err.message || '加密保存失败', true);
          return;
        }
      } else {
        await clearEncryptedKeys();
      }
    }
    window.dispatchEvent(new CustomEvent('script-flow-settings-saved'));
    closePanel();
  }

  container.querySelector('#settings-btn').addEventListener('click', openPanel);
  overlay.querySelector('#settings-close').addEventListener('click', closePanel);
  overlay.querySelector('#settings-cancel').addEventListener('click', closePanel);
  overlay.querySelector('#settings-save').addEventListener('click', saveSettings);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePanel();
  });

  overlay.querySelectorAll('input[name="key-mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) setKeyMode(el.value);
      syncUi();
    });
  });

  overlay.querySelector('#remember-keys').addEventListener('change', (e) => {
    passphraseInput.hidden = !e.target.checked;
    if (e.target.checked) passphraseInput.focus();
  });

  overlay.querySelector('#team-unlock-btn').addEventListener('click', async () => {
    const code = overlay.querySelector('#team-code-input').value.trim();
    try {
      await unlockTeam(code);
      teamStatus.textContent = '团队 Key 已解锁（7 天内有效）';
      showStatus('团队 Key 已解锁');
    } catch (err) {
      teamStatus.textContent = err.message;
      showStatus(err.message, true);
    }
  });

  return {
    openPanel,
    closePanel,
    async tryUnlockStoredKeys(passphrase) {
      const keys = await decryptKeys(passphrase);
      if (keys) setMemoryKeys(keys);
      return keys;
    },
  };
}

export { initSettings };
