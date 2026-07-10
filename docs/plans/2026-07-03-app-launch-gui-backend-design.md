# Design Specification: App Launch & GUI Backend Dependencies

This design document outlines the technical changes to resolve the application failing to open due to missing `pywebview` graphical backend dependencies.

## 1. Problem Statement
When running the application (either directly via `python3 app_window.py` or via the desktop/application launcher), the launch fails with:
`[-] Native window error: You must have either QT or GTK with Python extensions installed in order to use pywebview.`

This occurs because `pywebview` requires either GTK (via `PyGObject`/`gi`) or Qt (via `PyQt` or `PySide`) bindings, along with a compatible browser engine, which are not installed by default in the system or standard virtual environment.

## 2. Proposed Solution
Following the user-approved decision:
1. **Force Virtual Environment (`venv`) Usage:** We will modify `install.sh` to always create and use a Python virtual environment (`venv`) to run the application, isolating the desktop GUI dependencies from the system Python.
2. **Install GUI Dependencies:** We will install `PyQt5`, `PyQtWebEngine`, and `qtpy` in the virtual environment. PyQt5 provides a robust and portable Qt WebEngine backend on Linux without requiring complex system-level package setups.
3. **Application Launcher Alignment:** Update the `.desktop` launcher and systemd unit generation in `install.sh` to ensure they execute using the virtual environment's Python executable.

## 3. Detailed Changes

### A. Modify `install.sh`
- Remove the initial attempt to perform a system-wide user install using `python3 -m pip install --user --break-system-packages`.
- Directly attempt to create a local virtual environment: `python3 -m venv venv`.
- If the virtual environment creation fails, output a helpful instruction: `Please ensure 'python3-venv' is installed (e.g., 'sudo apt install python3-venv')`.
- Upgrade pip and install: `dulwich psutil pywebview PyQt5 PyQtWebEngine qtpy`.
- Correctly propagate user permissions (`chown`) if run under `sudo`.

## 4. Verification Plan
- Run `reinstall.sh` to execute the uninstallation and new installation process.
- Run `./venv/bin/python3 app_window.py` to confirm the application launches successfully.
- Verify the generated `.desktop` launcher executes the virtual environment's Python.
