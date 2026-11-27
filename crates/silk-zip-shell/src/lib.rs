//! Explorer context menu for Silk Zip (`IContextMenu`). Unlike registry verbs it can show the
//! selected file's name and change with the number of selected items. It only builds the menu
//! (entries come from `silk-zip-menu`); every action starts `silk-zip.exe --action=<action> <paths>`
//! from the DLL's own folder. In the Store package it also opens double-clicked archives (`open`).
#[cfg(windows)]
mod com;
#[cfg(windows)]
mod command;
#[cfg(windows)]
mod open;
