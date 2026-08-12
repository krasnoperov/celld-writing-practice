import { mount } from "svelte";
import "./tokens.css";
import "./base.css";
import Admin from "./admin/Admin.svelte";

mount(Admin, { target: document.getElementById("app") });
