import { mount } from "svelte";
import "./tokens.css";
import "./base.css";
import Page from "./site/Privacy.svelte";

mount(Page, { target: document.getElementById("app") });
